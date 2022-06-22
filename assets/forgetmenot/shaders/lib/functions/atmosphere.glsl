// ---------------------------------------
// Based in large part on:
// https://www.shadertoy.com/view/MstBWs 
// by robobo1221
// ---------------------------------------
// A very simple atmospheric scattering model, without any raymarching
// Very fast, almost free

vec3 sunDisk(in vec3 viewSpacePos, out float sunDisk) {
    viewSpacePos = normalize(viewSpacePos);
    float sun = dot(viewSpacePos, getSunVector());
    
    sun = smoothstep(0.9995, 0.9996, sun);
    sunDisk = sun;
    vec3 sunCol = sun * SUN_COLOR;

    float factor = mix(1.0, 0.0, frx_smoothedRainGradient);
    factor = mix(factor, 0.0, frx_thunderGradient);

    sunDisk *= 0.0 * smoothstep(0.0, -0.1, smoothstep(0.0, -0.1, getSunVector().y));

    return sunCol * factor * frx_worldIsOverworld;
}
vec3 moonDisk(in vec3 viewSpacePos, out float moonDisk) {
    viewSpacePos = normalize(viewSpacePos);
    float moon = dot(viewSpacePos, getMoonVector());
    
    moon = smoothstep(0.9996, 0.9997, moon);
    moonDisk = moon;
    vec3 moonCol = moon * MOON_COLOR;

    float factor = mix(1.0, 0.0, frx_smoothedRainGradient);
    factor = mix(factor, 0.0, frx_thunderGradient);

    moonDisk *= smoothstep(0.1, 0.0, smoothstep(0.0, -0.1, getMoonVector().y));

    return moonCol * factor * frx_worldIsOverworld;
}



vec3 scatter(vec3 coeff, float depth){
	return coeff * depth;
}

vec3 absorb(vec3 coeff, float depth){
	return exp2(scatter(coeff, -depth));
}

float henyeyGreenstein(float x, float g)
{
    float g2 = g * g;
    float x2 = x * x;

    float a = 3.0 * (1.0 - g2);
    float b = 2.0 * (2.0 + g2);
    float c = 1.0 + x2;
    float d = pow(1.0 + g2 - 2.0 * g * x, 1.5);

    return (a / b) * (c / d);
}

float kleinNishina(float x, float e) {
    return e / (2.0 * PI * (e * (1.0 - x) + 1.0) * log(2.0 * e + 1.0));
}

float rayleighPhase(float x){
    return 0.75 * (1.0 + x);
    //return henyeyGreenstein(x, 0.0);
	//return (3.0 / (16.0 * PI)) * (1.0 + x * x);
}
float miePhase(float x, float mieAmount)
{
    return kleinNishina(pow(x, 1.0 / mieAmount), mix(5000.0, 1000.0, frx_smoothedRainGradient));
 	//return henyeyGreenstein(x, 0.99);
}
float particleThickness(float depth){
   	
    depth = depth * 2.0;
    depth = max(depth + 0.02, 0.02);
    // depth = abs(depth);
    // if(depth < 0.01) depth = 0.01;
    depth = 1.0 / depth;
    
	return 100000.0 * depth;   
}

float particleThicknessConst(const float depth){
	return 100000.0 / max(depth * 2.0 - 0.01, 0.01);   
}

#define d0(x) (abs(x) + 1e-8)
#define d02(x) (abs(x) + 1e-3)
const vec3 rlhDay = (vec3(0.2, 0.5, 1.2) * 0.6e-5);
const vec3 mieDay = vec3(0.5e-6);
const vec3 totalDayCoeff = rlhDay + mieDay;

vec3 atmosphericScattering(in vec3 viewSpacePos, in vec3 sunVector, in float factor, in float sunBrightness) {
    const float ln2 = log(2.0);

    vec3 viewDir = normalize(viewSpacePos);
    vec3 unmodifiedViewDir = viewDir;

    // vec3 originalViewDir = viewDir;
    // vec3 loweredHorizonViewDir = viewDir;
    //loweredHorizonViewDir.y = clamp(loweredHorizonViewDir.y + 0.1, -1.0, 1.0);
    // viewDir.y = mix(viewDir.y, abs(viewDir.y), 1.0);
    //viewDir.y = max(0.025, viewDir.y);
    float horizonThing = pow(smoothstep(0.025, -0.5, viewDir.y), 10.0);
    viewDir.y = mix(viewDir.y, 0.025, smoothstep(0.1, -0.0, viewDir.y));

    // -------
    // Don't question my methods
    // -------

    float upDot = dot(vec3(0.0, 1.0, 0.0), viewDir);
    upDot = pow(upDot, 1.0);
	float opticalDepth = particleThickness(upDot + horizonThing * 0.01);

    float sunDotU = (dot(sunVector, vec3(0.0, 1.0, 0.0)));
    sunDotU = smoothstep(0.0, 1.0, sunDotU);
    // sunDotU = pow(sunDotU, 4.0);
    float sunDotV = clamp01(dot(sunVector, viewDir));
    sunDotV = mix(frx_smootherstep(0.0, 1.0, sunDotV), sunDotV, frx_smootherstep(0.0, 0.8, sunDotV));
    //sunDotV += frx_smootherstep(0.9995, 0.9997, sunDotV);
    sunDotV = clamp01(sunDotV);
    // sunDotV = pow(sunDotV, 14.0);
    // -------

    vec3 rayleigh = rlhDay;
    vec3 mie = mieDay;

    // what the hell is atmosphere anyway
    rayleigh = mix(rayleigh, vec3(0.1, 0.3, 1.0) * 1e-5, clamp01(upDot + sunDotU));

    // -------


    float sunOpticalDepth = particleThickness(sunDotU);

    vec3 dayScatterView = scatter(totalDayCoeff, opticalDepth);
    vec3 dayAbsorbView = absorb(totalDayCoeff, opticalDepth);

    vec3 dayScatterLight = scatter(totalDayCoeff, sunOpticalDepth);
    vec3 dayAbsorbLight = absorb(totalDayCoeff, sunOpticalDepth);

    vec3 absorbSun = abs(dayAbsorbLight - dayAbsorbView) / d0((dayScatterLight - dayScatterView) * ln2);

    vec3 rlhDayScatter = scatter(rayleigh, opticalDepth) * rayleighPhase(sunDotV);
    vec3 mieDayScatter = scatter(mie, opticalDepth) * miePhase(sunDotV, 10.0);

    vec3 scatterSun = rlhDayScatter * vec3(0.9, 1.0, 1.3) + mieDayScatter * 0.375;

    // -------

    vec3 totalScatter = scatterSun * sunBrightness * factor;
    if((frx_worldTime * 24000.0 > 23000.0 || frx_worldTime * 24000.0 < 22500.0) || 
       (frx_worldTime * 24000.0 < 12500.0 || frx_worldTime * 24000.0 > 13000.0)) {
        totalScatter += mix(1.0, 1.0, (sunDotU * sunDotU)) *
        mix(20.0, 400.0, getTimeOfDayFactors().y) * scatter(mie, opticalDepth) * 
        miePhase(frx_smootherstep(0.9995, 0.9997, sunDotV), opticalDepth) * 
        smoothstep(0.05, 0.1, unmodifiedViewDir.y) *
        frx_smootherstep(0.999, 0.9995, dot(viewDir, sunVector));
    }
    vec3 totalAbsorb = absorbSun * factor;

    vec3 gammaCorrectedAtmosphere = pow(totalScatter * totalAbsorb, vec3(1.0 / 2.2));
    gammaCorrectedAtmosphere = mix(vec3(frx_luminance(gammaCorrectedAtmosphere)), gammaCorrectedAtmosphere, 1.0);

    return gammaCorrectedAtmosphere;
}
vec3 atmosphericScatteringTop(in vec3 viewSpacePos, in vec3 sunVector, in float factor, in float sunBrightness, in float opticalDepth) {
    const float ln2 = log(2.0);

    sunBrightness = mix(sunBrightness, 2.0, float(frx_cameraInWater));

    vec3 viewDir = normalize(viewSpacePos);
    vec3 unmodifiedViewDir = viewDir;

    // vec3 originalViewDir = viewDir;
    // vec3 loweredHorizonViewDir = viewDir;
    //loweredHorizonViewDir.y = clamp(loweredHorizonViewDir.y + 0.1, -1.0, 1.0);
    // viewDir.y = mix(viewDir.y, abs(viewDir.y), 1.0);
    //viewDir.y = max(0.025, viewDir.y);
    float horizonThing = pow(smoothstep(0.025, -0.5, viewDir.y), 10.0);
    viewDir.y = mix(viewDir.y, 0.025, smoothstep(0.1, -0.0, viewDir.y));

    // -------
    // Don't question my methods
    // -------

    float sunDotU = mix((dot(sunVector, vec3(0.0, 1.0, 0.0))), 0.5, frx_cameraInWater);

    float upDot = dot(vec3(0.0, 1.0, 0.0), viewDir);
    upDot = pow(upDot, 1.0);
	opticalDepth = particleThicknessConst(1.0);
    opticalDepth *= mix(1.0, 25.0, 1.0 - clamp01(sunDotU));
    // float sunsetFactor = pow(1.0 - sunDotU, 2.0);
    // opticalDepth *= 2.0;
    // opticalDepth = pow(opticalDepth, max(2.0, mix(0.0, 4.0, sunsetFactor)));
    // opticalDepth = mix(opticalDepth, particleThicknessConst(0.05), smoothstep(0.1, 0.0, sunDotU));
    // opticalDepth = particleThicknessConst(pow(sunDotU, 2.0));
    // opticalDepth = mix(opticalDepth, 30000.0, float(frx_cameraInWater));

    sunDotU = smoothstep(0.0, 1.0, sunDotU);
    // sunDotU = pow(sunDotU, 4.0);
    float sunDotV = clamp01(dot(sunVector, viewDir)) * mix(1.0, 0.0, float(frx_cameraInWater));
    sunDotV = mix(frx_smootherstep(0.0, 1.0, sunDotV), sunDotV, frx_smootherstep(0.0, 0.8, sunDotV));
    // sunDotV = pow(sunDotV, 14.0);

    // -------

    vec3 rayleigh = rlhDay;
    vec3 mie = mieDay;

    // what even is atmosphere?
    rayleigh = mix(rayleigh, vec3(0.1, 0.3, 1.0) * 1e-5, clamp01(upDot + sunDotU));
    rayleigh = mix(rayleigh, vec3(0.0, 0.1, 0.2) * 1e-5, clamp01(frx_cameraInWater));

    // -------


    float sunOpticalDepth = particleThickness(sunDotU);

    vec3 dayScatterView = scatter(totalDayCoeff, opticalDepth);
    vec3 dayAbsorbView = absorb(totalDayCoeff, opticalDepth);

    vec3 dayScatterLight = scatter(totalDayCoeff, sunOpticalDepth);
    vec3 dayAbsorbLight = absorb(totalDayCoeff, sunOpticalDepth);

    vec3 absorbSun = abs(dayAbsorbLight - dayAbsorbView) / d0((dayScatterLight - dayScatterView) * ln2);

    vec3 rlhDayScatter = scatter(rayleigh, opticalDepth) * rayleighPhase(sunDotV);
    vec3 mieDayScatter = scatter(mie, opticalDepth) * miePhase(sunDotV, 20.0);

    vec3 scatterSun = rlhDayScatter + mieDayScatter;

    // -------

    vec3 totalScatter = scatterSun * sunBrightness * factor;
    vec3 totalAbsorb = absorbSun * factor;

    vec3 gammaCorrectedAtmosphere = pow(totalScatter * totalAbsorb, vec3(1.0 / 2.2));
    gammaCorrectedAtmosphere = mix(vec3(frx_luminance(gammaCorrectedAtmosphere)), gammaCorrectedAtmosphere, 1.0);

    return gammaCorrectedAtmosphere;
}

// vec3 waterFog(in vec3 color, in vec3 viewSpacePos) {

// }