/*
#include forgetmenot:shaders/lib/inc/lighting.glsl

Contains the diffuse lighting function as well as some other lighting utilities.
*/

#include forgetmenot:shaders/lib/inc/sky_display.glsl
#include forgetmenot:shaders/lib/inc/cubemap.glsl

// Lighting should only be in the fragment shader; requires things like IGN
#ifdef FRAGMENT_SHADER

// Distribution function for specular highlight
float distribution(in float NdotH, in float roughness) {
	float a = NdotH * roughness;
	float k = roughness / (1.0 - pow2(NdotH) + pow2(a));
	return k * k * (1.0 / PI);
}

// Schlick fresnel approximation
vec3 getReflectance(in vec3 f0, in float NdotV, in float roughness) {
	vec3 r = f0 + (1.0 - f0) * pow(1.0 - NdotV, 5.0);

	return mix(r, min(r, vec3(0.1)), roughness);
}

// --------------------------------------------------------------------------------------------------------
// https://github.com/spiralhalo/CanvasTutorial/wiki/Chapter-4
// Utility functions for cascaded shadow maps
// --------------------------------------------------------------------------------------------------------
vec3 shadowDist(int cascade, vec4 pos) {
	vec4 c = frx_shadowCenter(cascade);
	return abs((c.xyz - pos.xyz) / c.w);
}

// Function for obtaining the cascade level
int selectShadowCascade(vec4 shadowViewSpacePos) {
	vec3 d3 = shadowDist(3, shadowViewSpacePos);
	vec3 d2 = shadowDist(2, shadowViewSpacePos);
	vec3 d1 = shadowDist(1, shadowViewSpacePos);

	if(all(lessThan(d3, vec3(1.0)))) { return 3; }
	if(all(lessThan(d2, vec3(1.0)))) { return 2; }
	if(all(lessThan(d1, vec3(1.0)))) { return 1; }

	return 0;
}
// --------------------------------------------------------------------------------------------------------

float cascadeDistance(int cascade) {
	vec4 a = vec4(frx_viewDistance, 96.0, 32.0, 12.0);
	return a[cascade];
}

float getBiasAmount(int cascade) {
	vec4 biasAmounts = vec4(0.1);

	// Todo: this may need to be adjusted depending on shadow resolution
	#if SHADOW_RESOLUTION == RESOLUTION_512
		biasAmounts = vec4(0.2, 0.1, 0.05, 0.02);
	#elif SHADOW_RESOLUTION == RESOLUTION_1024
		biasAmounts = vec4(0.2, 0.1, 0.05, 0.02);
	#elif SHADOW_RESOLUTION == RESOLUTION_2048
		biasAmounts = vec4(0.2, 0.1, 0.05, 0.02);
	#elif SHADOW_RESOLUTION == RESOLUTION_3072
		biasAmounts = vec4(0.2, 0.1, 0.05, 0.02);
	#elif SHADOW_RESOLUTION == RESOLUTION_4096
		biasAmounts = vec4(0.2, 0.1, 0.05, 0.02);
	#endif

	return biasAmounts[cascade];
}

vec3 setupShadowPos(in vec3 sceneSpacePos, in vec3 normal, out int cascade) {
	#ifdef STRICT_SHADOW_BIAS
		vec4 shadowViewPos = frx_shadowViewMatrix * vec4(sceneSpacePos, 1.0);
		cascade = selectShadowCascade(shadowViewPos);

		shadowViewPos = frx_shadowViewMatrix * vec4(sceneSpacePos + normal * getBiasAmount(cascade), 1.0);
		cascade = selectShadowCascade(shadowViewPos);
	#else
		vec4 shadowViewPos = frx_shadowViewMatrix * vec4(sceneSpacePos + normal * 0.1, 1.0);
		cascade = selectShadowCascade(shadowViewPos);
	#endif

	vec4 shadowClipPos = frx_shadowProjectionMatrix(cascade) * shadowViewPos;
	vec3 shadowScreenPos = (shadowClipPos.xyz / shadowClipPos.w) * 0.5 + 0.5;

	return shadowScreenPos;
}

float getPenumbraSizeMultiplier() {
	return 1.0 + 20.0 * fmn_rainFactor;
}

float getShadowFactor(
	in vec3 sceneSpacePos,
	in vec3 vertexNormal,
	in float sssAmount,
	in bool doPcss,
	in int shadowMapSamples, 
	in sampler2DArray shadowMapTexture, 
	in sampler2DArrayShadow shadowMap
) {
	const float shadowSampleOffsetFactor = 2048.0;

	int cascade;
	vec3 shadowScreenPos = setupShadowPos(sceneSpacePos, vertexNormal, cascade);

	float shadowFactor = 0.0;
	float penumbraSize = 0.0;

	if(doPcss) {
		int pcssSamples = shadowMapSamples * 1;

		for(int i = 0; i < pcssSamples; i++) {
			vec2 sampleOffset = diskSampling(i, pcssSamples, sqrt(interleavedGradient(i + pcssSamples)) * TAU) * (250.0 / cascadeDistance(cascade));
			
			// Double the sample offset for penumbra search 
			vec2 sampleCoord = shadowScreenPos.xy + 2.0 * sampleOffset / shadowSampleOffsetFactor;

			float depthQuery = texture(shadowMapTexture, vec3(sampleCoord, cascade)).r;
			float diff = max(0.0, shadowScreenPos.z - depthQuery) * (frx_viewDistance * 20.0) / cascadeDistance(cascade);

			penumbraSize += diff / pcssSamples * getPenumbraSizeMultiplier();
		}
	} else {
		penumbraSize = 2.0;
	}

	penumbraSize = max(1.0, penumbraSize);
	penumbraSize = mix(penumbraSize, 500.0 / cascadeDistance(cascade), sssAmount * step(dot(vertexNormal, frx_skyLightVector), 0.25));

	for(int i = 0; i < shadowMapSamples; i++) {
		vec2 sampleOffset = diskSampling(i, shadowMapSamples, sqrt(interleavedGradient(i)) * TAU) * penumbraSize / shadowSampleOffsetFactor;
		shadowFactor += texture(shadowMap, vec4(shadowScreenPos.xy + sampleOffset, cascade, shadowScreenPos.z)) / shadowMapSamples;
	}

	return shadowFactor;
}

vec3 getSkyLightColor(
	in vec3 fragNormal,
	in float ambientOcclusion,
	in samplerCube skybox
) {
	vec3 ambientLighting = vec3(0.0);

	// #ifndef CLOUD_SHADOWS 
	// 	#define DIRECTIONAL_SKYLIGHT
	// #endif

	//#define DIRECTIONAL_SKYLIGHT
	#ifdef DIRECTIONAL_SKYLIGHT
		// Samples the cube map in the direction of the normal
		ambientLighting = interpolateCubemap(skybox, fragNormal).rgb;
	#else
		// Averages the color of all faces
		ambientLighting = 
			textureLod(skybox, vec3( 1.0,  0.0,  0.0), 7).rgb + 
			textureLod(skybox, vec3( 0.0,  1.0,  0.0), 7).rgb + 
			textureLod(skybox, vec3( 0.0,  0.0,  1.0), 7).rgb + 
			textureLod(skybox, vec3(-1.0,  0.0,  0.0), 7).rgb + 
			textureLod(skybox, vec3( 0.0, -1.0,  0.0), 7).rgb + 
			textureLod(skybox, vec3( 0.0,  0.0, -1.0), 7).rgb;

		ambientLighting /= 6.0;
	#endif

	if(frx_worldIsNether == 1) {
		#ifdef NETHER_DIFFUSE
			ambientLighting *= 4.0;
			ambientLighting += vec3(4.0, 1.5, 0.0) * (clamp01(-fragNormal.y * 0.75 + 0.25)) * ambientOcclusion;
		#endif
	} else if(frx_worldIsEnd == 1) {
		ambientLighting *= 0.1;
	}

	return ambientLighting;
}

vec3 getHandheldLightColor(
	in vec3 sceneSpacePos,
	in vec3 fragNormal
) {
	vec3 pos = sceneSpacePos + frx_cameraPos - frx_eyePos - vec3(0.0, 1.4, 0.0);

	float heldLightFactor = frx_smootherstep(pow4(frx_heldLight.a) * 13.0, 0.0, distance(frx_eyePos, sceneSpacePos + frx_cameraPos));
	heldLightFactor = pow3(heldLightFactor);

	// Spot lights
	{
		float innerAngle = sin(frx_heldLightInnerRadius);
		float outerAngle = sin(frx_heldLightOuterRadius);

		if(innerAngle != 0.0) {

			vec4 viewSpacePos = frx_viewMatrix * vec4(pos, 1.0);
			float blockDistance = max(0.0, -viewSpacePos.z);

			float distSq = dot(viewSpacePos.xy, viewSpacePos.xy);

			float innerLimit = pow2(innerAngle * blockDistance);
			float outerLimit = pow2(outerAngle * blockDistance);

			heldLightFactor = exp(-blockDistance / (max(0.01, frx_heldLight.a) * 8.0)) * smoothstep(outerLimit, innerLimit, distSq);
			heldLightFactor *= step(viewSpacePos.z, 0.0);
		}
	}

	heldLightFactor *= mix(clamp01(dot(-fragNormal, normalize(pos))), 1.0, frx_smootherstep(1.0, 0.0, distance(frx_eyePos + vec3(0.0, 1.0, 0.0), sceneSpacePos + frx_cameraPos))); // direct surfaces lit more - idea from Lumi Lights by spiralhalo

	#ifdef frx_isHand
		heldLightFactor = mix(heldLightFactor, 0.1, float(frx_isHand));
	#endif

	heldLightFactor *= 2.0 * step(0.01, frx_heldLight.a);
	return pow(frx_heldLight.rgb, vec3(2.2)) * heldLightFactor;
}

vec3 basicLighting(
	in vec3 albedo,

	in vec3 sceneSpacePos,

	in vec3 vertexNormal,
	in vec3 fragNormal,

	in float blockLight,
	in float skyLight,
	in float ambientOcclusion,

	in float f0,
	in float roughness,
	in float sssAmount,
	in float isWater,

	in samplerCube skybox,
	in sampler2D transmittanceLut,
	in sampler2DArrayShadow shadowMap,
	in sampler2DArray shadowMapTexture,
	in sampler2D lightTexture,

	bool doPcss,
	int shadowMapSamples,
	float nightVisionFactor,
	float sunBounceAmount
) {
	blockLight *= blockLight;
	skyLight *= skyLight;
	if(frx_worldHasSkylight == 0) skyLight = 1.0;

	float emission = clamp01(frx_luminance(albedo) - 1.0);
	float NdotL = mix(clamp01(dot(fragNormal, frx_skyLightVector)), 1.0, step(0.001, sssAmount));

	vec3 totalLighting = vec3(0.0);
	vec3 directLighting = vec3(0.0);
	vec3 ambientLighting = vec3(0.0);

	vec3 worldSpacePos = sceneSpacePos + vertexNormal * 0.05 + frx_cameraPos;

	#ifdef CLOUD_SHADOWS
		vec3 directLightColor = textureLod(skybox, frx_skyLightVector, 2.0).rgb * 0.04;
	#else
		// Samples sun transmittance directly rather than using the skybox
		vec3 directLightColor = 8.0 * getValFromTLUT(transmittanceLut, skyViewPos + vec3(0.0, 0.00002, 0.0) * max(0.0, (sceneSpacePos + frx_cameraPos).y - 60.0), frx_skyLightVector);
	#endif

	float shadowFactor = 0.0;

	// Direct lighting
	if(frx_worldHasSkylight == 1) {
		directLighting = directLightColor;
		directLighting *= (1.0 - 0.9 * fmn_rainFactor);
		
		shadowFactor = getShadowFactor(
			sceneSpacePos,
			vertexNormal,
			sssAmount,
			doPcss,
			shadowMapSamples,
			shadowMapTexture,
			shadowMap
		);
		shadowFactor *= skyLight * step(0.0, NdotL);
		
		directLighting *= (NdotL * shadowFactor + sunBounceAmount) * frx_skyLightTransitionFactor;
		if(frx_worldIsMoonlit == 1) directLighting = nightAdjust(directLighting) * 0.75;
	}

	// Ambient lighting
	{
		ambientLighting = getSkyLightColor(fragNormal, ambientOcclusion, skybox) * skyLight * 1.5;
		ambientLighting += AMBIENT_BRIGHTNESS;

		// Add block light
		vec3 blockLightColor = frx_getLightFiltered(lightTexture, worldSpacePos).rgb;
		blockLightColor = pow(blockLightColor, vec3(2.2));

		ambientLighting += blockLightColor * BLOCKLIGHT_BRIGHTNESS;
		
		// handheld light
		ambientLighting += 0.5 * getHandheldLightColor(sceneSpacePos, fragNormal);

		ambientLighting *= ambientOcclusion;
	}

	totalLighting += directLighting + ambientLighting;
	//totalLighting = mix(totalLighting, vec3(frx_luminance(totalLighting)), isWater);

	if(AMBIENT_BRIGHTNESS != 0.0) {
		// Tiny point light around the player so caves aren't completely dark
		totalLighting = max(totalLighting, vec3(0.05 * (1.0 - skyLight)) * exp(-length((sceneSpacePos + frx_cameraPos - frx_eyePos - vec3(0.0, 1.0, 0.0)) * 0.75)));
	}

	// Night vision
	totalLighting = mix(totalLighting, max(totalLighting, normalize(totalLighting) * ambientOcclusion), nightVisionFactor);

	vec3 color = albedo * (totalLighting + emission);

	// Specular highlight
	vec3 viewDir = -normalize(sceneSpacePos);
	vec3 halfwayVector = normalize(viewDir + frx_skyLightVector);

	float NdotH = clamp01(dot(halfwayVector, fragNormal));
	float NdotV = clamp01(dot(viewDir, fragNormal));

	// Hardcoding material params here 
	vec3 specularHighlightFactor = distribution(NdotH, 0.4) * getReflectance(vec3(0.0), NdotV, 0.0);
	color += 0.5 * shadowFactor * directLightColor * specularHighlightFactor;

	return color;
}
#endif
