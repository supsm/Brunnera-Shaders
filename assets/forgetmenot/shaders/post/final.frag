#include forgetmenot:shaders/lib/inc/header.glsl 
#include forgetmenot:shaders/lib/inc/noise.glsl 

#include forgetmenot:cam_properties
#include forgetmenot:cam_effects

uniform sampler2D u_color;
uniform sampler2D u_precise_uniforms;

in vec2 texcoord;
in float exposure;

layout(location = 0) out vec4 fragColor;

vec3 intpow(vec3 x, int exponent)
{
	vec3 ans = x;
	for (int i = 1; i < exponent; i++)
	{
		ans *= x;
	}
	return ans;
}

float intpow(float x, int exponent)
{
	float ans = x;
	for (int i = 1; i < exponent; i++)
	{
		ans *= x;
	}
	return ans;
}

// ceiling for positive floats to int
int intceil(float x)
{
	if (x == floor(x))
	{
		return int(x);
	}
	return int(x + 1);
}

// Lottes 2016, "Advanced Techniques and Optimization of HDR Color Pipelines"
vec3 lottes(vec3 x, float whitePoint) {
	const vec3 a = vec3(1.6);
	const vec3 d = vec3(0.977);
	 
	vec3 hdrMax = vec3(whitePoint);
	
	const vec3 midIn = vec3(0.18);
	const vec3 midOut = vec3(0.267);

	vec3 b =
		(-pow(midIn, a) + pow(hdrMax, a) * midOut) /
		((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);
	vec3 c =
		(pow(hdrMax, a * d) * pow(midIn, a) - pow(hdrMax, a) * pow(midIn, a * d) * midOut) /
		((pow(hdrMax, a * d) - pow(midIn, a * d)) * midOut);

	return pow(x, a) / (pow(x, a * d) * b + c);
}

float tonemap_approx(float x,
	float a, float b, float c, float d,
	float e, float f, float g, float h, float i)
{
	return (a * intpow(x, 4) + b * intpow(x, 3) + c * intpow(x, 2) + d * x) /
		(e * intpow(x, 4) + f * intpow(x, 3) + g * intpow(x, 2) + h * x + i);
}
float tonemap_approx(float x,
	float a, float b, float c, float d, float e,
	float f, float g, float h, float i, float j, float k)
{
	return (a * intpow(x, 5) + b * intpow(x, 4) + c * intpow(x, 3) + d * intpow(x, 2) + e * x) /
		(f * intpow(x, 5) + g * intpow(x, 4) + h * intpow(x, 3) + i * intpow(x, 2) + j * x + k);
}

// sample u_color with an approximation of gaussian blur using downsamples,
// centered at `center` with standard deviation of `stddev`
vec3 sample_gaussian_approx(vec2 center, float stddev)
{
	if (stddev == 0)
	{
		return texture(u_color, center).rgb;
	}
	float lod = clamp(log2(abs(stddev)) - 1, 0, 6);
	return textureLod(u_color, center, lod).rgb;
}

void main() {
	initGlobals();

	float frame_time = texelFetch(u_precise_uniforms, ivec2(1, 0), 0).x;
	const float aperture_diameter = 1.0 / APERTURE;

	// lens/sensor effects

	vec3 color;
	float expo = exposure;//clamp(exposure, 0.001, 0.002);

#ifdef CHROMATIC_ABERRATION
	// Chromatic Aberration
	// must be positive or lateral chromatic aberration will cause artifacts at sides
	// TODO: lateral artifacts can be solved by shifting so that minimum = 0
	const vec3 focus_error = vec3(2.1, 0, 2.7);
	// lateral chromatic aberration
	// save coordinate multiplier and sample later
	const vec3 lat_focus_err = pow(10, LATERAL_CA_STRENGTH) * focus_error;
	const vec3 coord_mults = (vec3(1) - 2 * lat_focus_err);
	// axial chromatic aberration
	const vec3 axi_focus_err = AXIAL_CA_STRENGTH * focus_error * aperture_diameter;
	color.r = sample_gaussian_approx(texcoord * coord_mults.r + lat_focus_err.r, axi_focus_err.r).r;
	color.g = sample_gaussian_approx(texcoord * coord_mults.g + lat_focus_err.g, axi_focus_err.g).g;
	color.b = sample_gaussian_approx(texcoord * coord_mults.b + lat_focus_err.b, axi_focus_err.b).b;
#else
	color = texture(u_color, texcoord).rgb;
#endif

#ifdef SENSOR_NOISE
	// inverse of total light exposure multiplier (arbitrary units)
	// 1 / APERTURE = aperture diameter
	float inv_exp = APERTURE * APERTURE / frame_time * sqrt(1e-7 * frxu_size.x * frxu_size.y);

#if CAM_TYPE == CAM_TYPE_DIGITAL
	// digital noise (additive and subtractive, per-channel)
	// exposure affects noise directly
	float noisiness = 0.00008 * sqrt(inv_exp);
	color += vec4(normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness), normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness)).xyz;
#else
	// film grain (multiplicative, monochromatic)
	// brightness simulates grain size, which is affected by iso
	// iso has arbitrary units
	float iso = 0.002 * sqrt(inv_exp / expo);
	color *= 1 - max(0, normal_distribution(vec2(randomFloat(), randomFloat()), 0, min(5.0, 0.2 * iso * iso)).x) * float(randomFloat() > 0.2);
#endif
#endif


	// post processing

	vec3 finalColor = color.rgb;

	// TODO: AWB or smth

	// these tonemaps are fitted from "Camera Response Functions"
	// from Columbia University's Computer Imaging and Vision Laboratory
	// https://www.cs.columbia.edu/CAVE/software/softlib/dorf.php
#if CAM_TYPE == CAM_TYPE_DIGITAL
	// dscs315-1 (4/4 approx)
	float white_point = expo * 1600;
	float x = clamp01(finalColor.r / white_point);
	finalColor.r = tonemap_approx(x, -10.54, 19.27, -5.93, 0.79, -8.86, 14.15, -1.35, -0.52, 0.17);
	x = clamp01(finalColor.g / white_point);
	finalColor.g = tonemap_approx(x, -36.77, 12.76, -1.46, 0, -31, 4.82, 0.87, -0.25, 0);
	x = clamp01(finalColor.b / white_point);
	finalColor.b = tonemap_approx(x, -37.3, 13.34, -1.63, 0, -31.03, 4.62, 1.05, -0.31, 0);
	finalColor = clamp01(finalColor);
#elif CAM_TYPE == CAM_TYPE_FILM1
	// ektachrome 100 plus (5/5 approx)
	float white_point = expo * 1280;
	float x = clamp01(finalColor.r / white_point); // 0.8
	finalColor.r = tonemap_approx(x, 4.777, -0.641, 0.006, 0.005, 0, 4.812, -0.772, 0.096, 0.021, -0.006, 0.001);
	x = clamp01(finalColor.g / (white_point * 0.95)); // 0.76
	finalColor.g = tonemap_approx(x, 1.489, 2.754, 1.234, 0.069, 0.007, 0.419, 5.620, -1.736, 1.414, -0.194, 0.031);
	x = clamp01(finalColor.b / (white_point * 0.95)); // 0.76
	finalColor.b = tonemap_approx(x, 9.115, -4.222, 0.540, 0, 0.002, 7.377, -1.580, -0.620, 0.304, -0.058, 0.007);
	finalColor = clamp01(finalColor);
#elif CAM_TYPE == CAM_TYPE_FILM2
	// gold 200 (4/4 approx)
	float white_point = expo * 1600;
	float x = clamp01(finalColor.r / white_point);
	finalColor.r = tonemap_approx(x, -1446.21, 339.41, -71.10, -4.44, -958.53, -268.05, 80.64, -32.42, -0.57);
	x = clamp01(finalColor.g / white_point);
	finalColor.g = tonemap_approx(x, -1627.54, 1106.05, -245.18, -31.58, -901.04, -157.98, 434.21, -166.83, -5.76);
	x = clamp01(finalColor.b / white_point);
	finalColor.b = tonemap_approx(x, -1606.57, 726.14, -200.30, -13.98, -840.76, -410.04, 282.62, -119.58, -3.82);
	finalColor = clamp01(finalColor);
#else
	// portra 400 NC (4/4 approx)
	float white_point = expo * 1200;
	float x = clamp01(finalColor.r / white_point);
	finalColor.r = tonemap_approx(x, 1968.8, 962.30, 43.62, 0.28, 696.17, 1965.73, 503.28, 6.11, 0.02);
	x = clamp01(finalColor.g / white_point);
	finalColor.g = tonemap_approx(x, 3.49, -1.76, -1.81, -0.06, 1.08, 2.57, -3.19, -0.58, -0.01);
	x = clamp01(finalColor.b / white_point);
	finalColor.b = tonemap_approx(x, 2.96, -1.16, -1.98, -0.07, 0.59, 2.94, -2.97, -0.80, -0.01);
	finalColor = clamp01(finalColor);
#endif

	//const int bitDepth = 256;
	//finalColor = round(finalColor * bitDepth) / bitDepth;

	fragColor = vec4(finalColor, 1.0);
}