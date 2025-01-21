#include forgetmenot:shaders/lib/inc/sky.glsl
#include forgetmenot:shaders/lib/inc/noise.glsl

vec3 sampleAtmosphere(in vec3 viewDir, in sampler2D skyLutDay, in sampler2D skyLutNight, in sampler2D transmittanceLut, in sampler2D multiscatteringLut) {
	if(frx_worldIsOverworld == 1) {
		vec3 skyViewPos = getSkyViewPos();
		vec3 skyColor;

		if (length(skyViewPos) < atmosphereRadiusMM) {
			skyColor =
				2.0 * getValFromSkyLUT(viewDir, getSunVector(), skyLutDay) + 
				getValFromSkyLUT(viewDir, getMoonVector(), skyLutNight);
		} else {
			float atmoDist = rayIntersectSphere(skyViewPos, viewDir, atmosphereRadiusMM);
			float groundDist = rayIntersectSphere(skyViewPos, viewDir, groundRadiusMM);

			float tMax = (groundDist < 0.0) ? atmoDist : groundDist;

			skyColor =
				raymarchScattering(skyViewPos, viewDir, getSunVector(), tMax, float(numScatteringSteps), transmittanceLut, multiscatteringLut, SUN_COLOR) + 
				nightAdjust(raymarchScattering(skyViewPos, viewDir, getMoonVector(), tMax, float(numScatteringSteps), transmittanceLut, multiscatteringLut, MOON_COLOR));
		}

		return skyColor * 7.5;
	}
	if(frx_worldIsNether == 1) {
		return normalize(pow(frx_fogColor.rgb, vec3(2.2))) * 0.4 + 0.075;
	}
	if(frx_worldIsEnd == 1) {
		return vec3(0.0);
	}

	return pow(frx_fogColor.rgb, vec3(2.2));
}

void drawSunOnAtmosphere(inout vec3 atmosphere, in vec3 viewDir, in sampler2D transmittanceLut) {
	if(frx_worldHasSkylight != 1) {
		return;
	}
	vec3 skyViewPos = getSkyViewPos();

	vec3 sunVector = getSunVector();
	vec3 moonVector = getMoonVector();

	vec3 sunTransmittance = getValFromTLUT(transmittanceLut, skyViewPos, viewDir);
	vec3 moonTransmittance = nightAdjust(getValFromTLUT(transmittanceLut, skyViewPos, viewDir));

	float distToPlanet = rayIntersectSphere(skyViewPos, viewDir, groundRadiusMM);

	float sunBrightness = 100.0 * step(distToPlanet, 0.0);

	vec3 sunDisk = smoothstep(0.99975, 0.99977, dot(viewDir, sunVector)) * sunTransmittance * sunBrightness * SUN_COLOR;
	vec3 moonDisk = smoothstep(0.99985, 0.99987, dot(viewDir, moonVector)) * moonTransmittance * sunBrightness * MOON_COLOR;

	// TODO: moon phases (use nightAdjustMoon)

	atmosphere += sunDisk + moonDisk;
}

void drawStarsOnAtmosphere(inout vec3 atmosphere, in vec3 viewDir, in sampler2D transmittanceLut) {
	if(frx_worldIsEnd == 1) {
		vec2 plane = viewDir.xz / (abs(viewDir.y + length(viewDir.xz) * 0.3));
		plane *= 10.0;

		// Normal stars
		vec3 stars = vec3(0.0);
		vec3 starColor = normalize(hash32(floor(plane)) + 0.001);

		for(int i = 0; i < 3; i++) {
			float brightness = 1.0 + 10.0 * hash12(vec2(i) + floor(plane));
			stars += brightness * step(0.95 - 0.03 * i, 1.0 - cellular2x2x2(viewDir * 40.0 * (1.0 + i * 0.1)).x);
		}

		atmosphere += (starColor * 0.5 + 0.5) * 0.3 * stars;

		// Special stars 
		float starDensity = exp(-abs(pow2(rotate2D(viewDir.yz, 0.6).y)) * 20.0);
		starDensity *= smoothstep(0.0, 0.01, starDensity);

		stars = vec3(0.0);
		starColor *= vec3(0.5, 1.5, 0.9);

		for(int i = 0; i < 3; i++) {
			int j = i + 3;

			float brightness = 1.0 + 10.0 * hash12(vec2(j) + floor(plane));
			stars += brightness * step(0.95 - 0.03 * i, 1.0 - cellular2x2x2(viewDir * 40.0 * (1.0 + j * 0.1)).x);
		}

		atmosphere += starColor * 40.0 * stars * starDensity;
		
		// Fog
		float noise = fbmHash3D(viewDir, 5, 3.0, 0.0);
		atmosphere += vec3(0.2, 0.9, 0.4) * pow4(noise) * (starDensity);

		return;
	}
	if(frx_worldHasSkylight != 1) {
		return;
	}
	vec3 skyViewPos = getSkyViewPos();

	vec3 sunTransmittance = getValFromTLUT(transmittanceLut, skyViewPos, viewDir);
	vec3 moonTransmittance = nightAdjust(getValFromTLUT(transmittanceLut, skyViewPos, viewDir));

	vec3 starViewDir = viewDir;
	starViewDir.xy = rotate2D(starViewDir.xy, -frx_skyAngleRadians);
	starViewDir.y = abs(starViewDir.y);

	vec2 starPlane = starViewDir.xz / (starViewDir.y + length(starViewDir.xz));
	starPlane *= 750.0;

	const float starThreshold = 0.995;

	vec3 stars = vec3(step(starThreshold, hash12(floor(starPlane))) * moonTransmittance); // Star shape
	stars *= (hash32(floor(starPlane)) * 0.7 + 0.3); // Star color
	stars *= 1.0 + 5.0 * step(starThreshold * 0.5 + 0.5, hash12(floor(starPlane))); // Star brightness

	vec3 tdata = getTimeOfDayFactors();
	float starMultiplier = tdata.z * 0.5 + tdata.y;

	atmosphere += stars;
}

vec2 createCloudPlane(in vec3 viewDir) {
	return 2.0 * (viewDir.xz) * rcp(0.1 * dotSelf(viewDir.xz) + viewDir.y);
}

struct CloudLayer {
	float altitude;
	vec2 plane;

	float density;
	int selfShadowSteps;

	bool useNoiseTexture;

	int noiseOctaves;
	float noiseLacunarity;
	float noiseLowerBound;
	float noiseUpperBound;

	vec2 domainMult;
	float rangeMult;

	vec2 domainShift;
	float rangeShift;

	float curlNoiseAmount;
	float curlNoiseFrequency;

	bool render;
};

CloudLayer createCumulusCloudLayer(in vec3 viewDir) {
	CloudLayer cloudLayer;

	#ifndef CUMULUS_CLOUDS
		cloudLayer.render = false;
		return cloudLayer;
	#endif

	cloudLayer.altitude = 0.001;
	cloudLayer.plane = createCloudPlane(viewDir) + 0.00001 * frx_cameraPos.xz / cloudLayer.altitude + 0.00001 * fmn_time / cloudLayer.altitude;

	cloudLayer.density = 45.0 + 40.0 * fmn_rainFactor;
	cloudLayer.selfShadowSteps = 5;

	cloudLayer.useNoiseTexture = false;

	cloudLayer.noiseOctaves = 6;
	cloudLayer.noiseLacunarity = 2.5;
	cloudLayer.noiseLowerBound = 0.35 - 0.3 * fmn_rainFactor;
	cloudLayer.noiseUpperBound = 1.5;
	
	cloudLayer.domainMult = vec2(1.0);
	cloudLayer.rangeMult = mix(smoothHash(cloudLayer.plane * 0.3 + frx_renderSeconds * 0.01), 1.0, smoothstep(0.2, 0.4, fmn_atmosphereParams.cloudCoverage));

	cloudLayer.domainShift = vec2(0.0);
	cloudLayer.rangeShift = fmn_atmosphereParams.cloudCoverage;

	cloudLayer.curlNoiseAmount = 0.000075;
	cloudLayer.curlNoiseFrequency = 4.0;

	cloudLayer.render = true;

	return cloudLayer;
}

CloudLayer createCirrusCloudLayer(in vec3 viewDir) {
	CloudLayer cloudLayer;

	#ifndef CIRRUS_CLOUDS
		cloudLayer.render = false;
		return cloudLayer;
	#endif

	cloudLayer.altitude = 0.01;
	cloudLayer.plane = createCloudPlane(viewDir) + 0.00001 * frx_cameraPos.xz / cloudLayer.altitude;

	cloudLayer.density = 2.0;
	cloudLayer.selfShadowSteps = 0;
	
	cloudLayer.useNoiseTexture = false;

	cloudLayer.noiseOctaves = 6;
	cloudLayer.noiseLacunarity = 2.0;
	cloudLayer.noiseLowerBound = 0.3;
	cloudLayer.noiseUpperBound = 1.5;

	cloudLayer.domainMult = vec2(6.0, 1.0);
	cloudLayer.rangeMult = smoothHash(cloudLayer.plane + frx_renderSeconds * 0.01);

	cloudLayer.domainShift = vec2(0.0);
	cloudLayer.rangeShift = -0.1;

	cloudLayer.curlNoiseAmount = 0.00035;
	cloudLayer.curlNoiseFrequency = 0.75;

	cloudLayer.render = true;

	return cloudLayer;
}

float sampleCloudNoise(in CloudLayer cloudLayer, in int noiseOctaves) {
	if(!cloudLayer.render) {
		return 0.0;
	}

	if(cloudLayer.useNoiseTexture) {
		return -1.0;
	}
	
	return smoothstep(
		cloudLayer.noiseLowerBound,
		cloudLayer.noiseUpperBound,
		(
			fbmHash(
				(cloudLayer.plane + cloudLayer.domainShift + curlNoise(cloudLayer.plane * cloudLayer.curlNoiseFrequency) * cloudLayer.curlNoiseAmount) * cloudLayer.domainMult,
				noiseOctaves,
				cloudLayer.noiseLacunarity,
				0.05
			) + cloudLayer.rangeShift
		) * cloudLayer.rangeMult
	);
}
float sampleCloudNoise(in CloudLayer cloudLayer) {
	return sampleCloudNoise(cloudLayer, cloudLayer.noiseOctaves);
}
float sampleCloudNoise(in CloudLayer cloudLayer, in sampler2D noiseTexture) {
	if(!cloudLayer.render) {
		return 0.0;
	}

	if(!cloudLayer.useNoiseTexture) {
		return -1.0;
	}

	return smoothstep(
		cloudLayer.noiseLowerBound,
		cloudLayer.noiseUpperBound,
		texture(noiseTexture, cloudLayer.plane * cloudLayer.domainMult + 0.0001 / cloudLayer.altitude).r * cloudLayer.rangeMult
	);
}

vec2 getCloudsTransmittanceAndScattering(in vec3 viewDir, in CloudLayer cloudLayer) {
	if(rayIntersectSphere(getSkyViewPos(), viewDir, groundRadiusMM) > 0.0) {
		return vec2(1.0, 0.0);
	}

	vec2 plane = cloudLayer.plane;

	float noise = sampleCloudNoise(cloudLayer);
	
	float transmittance = exp2(-noise * cloudLayer.density);
	float scattering = 0.75;

	if(cloudLayer.selfShadowSteps > 0) {
		vec2 temp = viewDir.xz * rcp(viewDir.y);
		float skyLightZenithAngle = rcp(abs(frx_skyLightVector.y));
		vec2 sunLightDirection = mix(
			normalize(getSunVector().xz * skyLightZenithAngle - temp),
			normalize(getMoonVector().xz * skyLightZenithAngle - temp),
			linearstepFrom0(0.2, getMoonVector().y)
		);

		sunLightDirection = normalize(sunLightDirection);

		float lightOpticalDepth = 0.0;

		int selfShadowCloudDetail = max(1, cloudLayer.selfShadowSteps - 1);

		for(int i = 0; i < cloudLayer.selfShadowSteps; i++) {
			cloudLayer.plane += sunLightDirection * rcp(cloudLayer.selfShadowSteps) * interleavedGradient(i) * 0.5;
			lightOpticalDepth += sampleCloudNoise(cloudLayer, selfShadowCloudDetail) * rcp(cloudLayer.selfShadowSteps);
		}

		lightOpticalDepth = max(0.0, lightOpticalDepth);
		scattering = exp2(-lightOpticalDepth * cloudLayer.density * 0.3);
	}

	transmittance = mix(transmittance, 1.0, exp(-clamp01(viewDir.y) * 10.0));

	return vec2(
		transmittance,
		scattering
	);
}

vec3 getClouds(in vec3 viewDir, in CloudLayer cloudLayer, in sampler2D transmittanceLut, vec3 skyColor, vec3 ambientColor) {
	if(frx_worldHasSkylight == 0 || fmn_isModdedDimension) {
		return skyColor;
	}

	vec2 cloudsTransmittanceAndScattering = getCloudsTransmittanceAndScattering(viewDir, cloudLayer);

	vec3 sunVector = getSunVector();
	vec3 moonVector = getMoonVector();

	vec3 cloudPos = vec3(
		0.0,
		getSkyViewPos().y + cloudLayer.altitude * (dot(viewDir, sunVector) * 0.5 + 0.5),
		0.0
	);

	vec3 sunColor = getValFromTLUT(transmittanceLut, cloudPos, sunVector);
	vec3 moonColor = nightAdjust(getValFromTLUT(transmittanceLut, cloudPos, moonVector));

	vec3 scatteringColor = (sunColor + moonColor) * 2.0;

	float mieMultiplier = 10.0;

	#ifdef IGNORE_MIE_SCATTERING_ON_CLOUDS
		mieMultiplier = 0.0;
	#endif

	vec3 scattering = cloudsTransmittanceAndScattering.y * scatteringColor * (
		4.0 + mieMultiplier * (getMiePhase(dot(viewDir, sunVector), 0.8) + 
		0.5 * getMiePhase(dot(viewDir, moonVector), 0.7))
	) + ambientColor * 1.5;

	return mix(scattering, skyColor, clamp01(cloudsTransmittanceAndScattering.x));
}

void drawCloudsOnAtmosphere(inout vec3 atmosphere, in vec3 viewDir, in sampler2D transmittanceLut, vec3 sky_only)
{
	if(frx_worldHasSkylight == 1) {
		CloudLayer cirrusClouds = createCirrusCloudLayer(viewDir);
		CloudLayer cumulusClouds = createCumulusCloudLayer(viewDir);
		vec3 color = getClouds(viewDir, cirrusClouds, transmittanceLut, atmosphere, sky_only);
		color = getClouds(viewDir, cumulusClouds, transmittanceLut, color, sky_only);
		atmosphere = (color + sky_only) * 0.5;
	}
}
