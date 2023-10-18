#include forgetmenot:shaders/lib/inc/header.glsl 
#include forgetmenot:shaders/lib/inc/noise.glsl 

#include forgetmenot:cam_properties
#include forgetmenot:cam_effects

uniform sampler2D u_color;
uniform sampler2D u_downsampled;
uniform sampler2D u_depth;
uniform sampler2D u_depth_downsampled;
uniform sampler2D u_hand_depth;
uniform sampler2D u_exposure;
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

// center is [0, 1]
// stddev is in pixels
// kernel_size_stddevs refers to one side of kernel only
// depth_multiplier is 0 for no checking depth
//     otherwise will multiply sampled depth by depth_multiplier
//     and only sample color if value is GREATER than or equal to depth at current pixel
//     (use negative for less than or equal)
//     ignored for lods
// focus depth is depth of focus point, only used for forward-blending for depth
//     when not -1 it will sample depth instead of color
// last element of return value is sum of multipliers
vec4 sample_gaussian(vec2 center, float stddev, float kernel_size_stddevs = 2, vec2 step_size = vec2(1), float depth_multiplier = 0, float focus_depth = -1)
{
	vec4 default_val = vec4(texture((focus_depth == -1 ? u_color : u_depth), center).rgb, 1);
	if (stddev == 0)
	{
		return default_val;
	}

	// TODO: put config in pipeline thingy so downsample doesn't even happen
#ifdef FAST_DOF
	float lod = clamp(log2(stddev) - 2, 0, 6);
	if (lod != 0)
	{
		stddev = 4; // divide stddev so transitions are smoother
		if (focus_depth == -1) { depth_multiplier = 0; } // disable depth check for color lod
	}
#else
	float lod = 0;
#endif

	vec2 pixel_size = 1.0 / frxu_size * exp2(lod);
	vec2 step_one = step_size * pixel_size;
	// log kernel size to make higher blurs use less samples
	// yes this will blur less but it's probably ok
	float kernel_size = kernel_size_stddevs * stddev;
	// shrink kernel size to distance to edge, if necessary
	// TODO: make stddev resolution-aware?
	vec2 half_kernel_size_f = min(vec2(kernel_size), frxu_size * min(center, 1 - center)) * pixel_size;

	vec3 sum = vec3(0);
	float mult_sum = 0;
	float orig_depth;
	if (depth_multiplier != 0)
	{
		orig_depth = texture(u_depth, center).x;
	}
	for (float i = center.x - half_kernel_size_f.x; i <= center.x + half_kernel_size_f.x; i += step_one.x)
	{
		for (float j = center.y - half_kernel_size_f.y; j <= center.y + half_kernel_size_f.y; j += step_one.y)
		{
			float dist = length(vec2(i, j) - center) / stddev;
			if (dist > kernel_size_stddevs)
			{
				continue;
			}

			float sample_depth;
			if (depth_multiplier != 0 || focus_depth != -1)
			{
				sample_depth = (lod < 1 ?
					texture(u_depth, vec2(i, j)).x :
					textureLod(u_depth_downsampled, vec2(i, j), lod).x);
			}
			else
			{
				sample_depth = 0;
			}

			bool run = true;
			if (depth_multiplier != 0)
			{
				if (!((sample_depth * depth_multiplier > sign(depth_multiplier) * orig_depth || abs(sample_depth * depth_multiplier) == orig_depth) &&
					(focus_depth == -1 ? true : orig_depth < focus_depth)))
				{
					run = false;
				}
			}

			if (run)
			{
				vec3 sample;
				if (focus_depth == -1)
				{
					sample = (lod < 1 ?
						texture(u_color, vec2(i, j)).rgb :
						textureLod(u_downsampled, vec2(i, j), lod).rgb);
				}
				else
				{
					sample = vec3(sample_depth);
				}
				// we can leave out 1/(stddev*sqrt(2*PI)) because constants cancel out in division
				float multiplier = exp(-0.5 * dist * dist);
				sum += sample * multiplier;
				mult_sum += multiplier;
			}
		}
	}
	if (mult_sum == 0)
	{
		return (lod < 1 ?
			default_val :
			vec4(textureLod((focus_depth == -1 ? u_downsampled : u_depth_downsampled), center, lod).rgb, 1));
	}
	return vec4(sum / mult_sum, mult_sum);
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

void main() {
	initGlobals();

	// TODO: don't instantly change focus, make it transition somewhat slowly
	float focus_depth = texture(u_depth, vec2(0.5)).x;
	//float pixel_depth = min(texture(u_depth, texcoord).x, texture(u_hand_depth, texcoord).x);
	// TODO: cache depth samples? sampling is very expensive
	float hand_depth = texture(u_hand_depth, texcoord).x;
	vec4 pixel_depth_info;
	// TODO: fix hand
	if (hand_depth > 0) // not part of hand
	{
		pixel_depth_info = sample_gaussian(texcoord, 4, 2, vec2(1.5), -1, focus_depth);
	}
	else // part of hand
	{
		pixel_depth_info = vec4(vec3(hand_depth), 1);
	} 
	float pixel_depth = pixel_depth_info.x;
	float dof_strength = 200 * abs(focus_depth - pixel_depth);
	// allow forward blending (depth_multiplier = 0) if sample took on depth of another pixel (pixel_depth_info.z > 1)
	vec3 color = sample_gaussian(texcoord, dof_strength, 2, vec2(1.5), (pixel_depth_info.z < 1.05 ? 1.02 : 0)).rgb;

	/*// must be positive or lateral chromatic aberration will cause artifacts at sides
	// and axial cromatic aberration will lead due negative stddev, kernel size (no abs is used)
	vec3 focus_error = vec3(2.1, 0, 2.7);
	// lateral chromatic aberration
	// save coordinate multiplier and sample later
	vec3 lat_focus_err = 0.001 * focus_error;
	vec3 coord_mults = (vec3(1) - 2 * lat_focus_err);
	// axial chromatic aberration
	// keep this subtle or forests/grass will look like trash
	vec3 axi_focus_err = 0.1 * focus_error;
	color.r = sample_gaussian(texcoord * coord_mults.r + lat_focus_err.r, axi_focus_err.r, 2)).r;
	color.g = sample_gaussian(texcoord * coord_mults.g + lat_focus_err.g, axi_focus_err.g, 2)).g;
	color.b = sample_gaussian(texcoord * coord_mults.b + lat_focus_err.b, axi_focus_err.b, 2)).b;*/

	vec3 finalColor = color.rgb;

	float expo = clamp(exposure, 0.0003, 0.002);

	// aces tonemap
	//finalColor = FRX_ACES_INPUT_MATRIX * finalColor;
	//finalColor = frx_toneMap(finalColor);
	//finalColor = FRX_ACES_OUTPUT_MATRIX * finalColor;
	// supsm's wacky tonemap
	/*
	finalColor = ((0.97205 * tanh(2 *  finalColor - 0.2) - 0.02795) * tanh(2 * finalColor + 0.26) + 0.0559) *
		(exp(-8 * finalColor + 1) + 1) *
		(-(0.8 * intpow(finalColor, 2) - 0.3 * finalColor) / (intpow(finalColor, 4) + 2 * intpow(finalColor, 2) + 0.2 * finalColor) + 1) *
		(1 - exp(-25 * finalColor)); //*/
	// reinhard
	//finalColor = finalColor / (finalColor + vec3(1));
	// new lumi
	//finalColor = -exp(0.69314717 - 1.386294 * finalColor) * 0.5 + 1;
	// lottes
	//finalColor = lottes(finalColor, 8);
	// linear
	//finalColor = clamp(finalColor, vec3(0), vec3(1));
#if CAM_TYPE == CAM_TYPE_DIGITAL
	// dscs315-1 (4/4 approx)
	float white_point = expo * 1600;
	float x = clamp(finalColor.r, 0, white_point) / white_point;
	finalColor.r = tonemap_approx(x, -10.54, 19.27, -5.93, 0.79, -8.86, 14.15, -1.35, -0.52, 0.17);
	x = clamp(finalColor.g, 0, white_point) / white_point;
	finalColor.g = tonemap_approx(x, -36.77, 12.76, -1.46, 0, -31, 4.82, 0.87, -0.25, 0);
	x = clamp(finalColor.b, 0, white_point) / white_point;
	finalColor.b = tonemap_approx(x, -37.3, 13.34, -1.63, 0, -31.03, 4.62, 1.05, -0.31, 0);
	finalColor = clamp01(finalColor);
#else
	// ektachrome 100 plus (5/5 approx)
	// very yellow for some reason
	/*float white_point = expo * 1600;
	float x = clamp(finalColor.r, 0, white_point) / white_point;
	finalColor.r = tonemap_approx(x, 4737.11, -635.97, 6.04, 4.89, 0.24, 4771.84, -765.86, 95.52, 21.02, -6.19, 0.61);
	x = clamp(finalColor.g, 0, white_point) / white_point;
	finalColor.g = tonemap_approx(x, 1586.67, 2935.85, 1315.78, 73.41, 7.05, 447.01, 5989.87, -1850.5, 1507.16, -206.73, 32.78);
	x = clamp(finalColor.b, 0, white_point) / white_point;
	finalColor.b = tonemap_approx(x, 5832.11, -2701.59, 234.58, 0.07, 1.28, 4720.28, -1011.13, -396.94, 194.41, -36.87, 4.34);
	finalColor = clamp01(finalColor);*/
	// gold 200 (4/4 approx)
	float white_point = expo * 1600;
	float x = clamp(finalColor.r, 0, white_point) / white_point;
	finalColor.r = tonemap_approx(x, -1446.21, 339.41, -71.10, -4.44, -958.53, -268.05, 80.64, -32.42, -0.57);
	x = clamp(finalColor.g, 0, white_point) / white_point;
	finalColor.g = tonemap_approx(x, -1627.54, 1106.05, -245.18, -31.58, -901.04, -157.98, 434.21, -166.83, -5.76);
	x = clamp(finalColor.b, 0, white_point) / white_point;
	finalColor.b = tonemap_approx(x, -1606.57, 726.14, -200.30, -13.98, -840.76, -410.04, 282.62, -119.58, -3.82);
	finalColor = clamp01(finalColor);
	// portra 400 NC (4/4 approx)
	/*float white_point = expo * 1600;
	float x = clamp(finalColor.r, 0, white_point) / white_point;
	finalColor.r = tonemap_approx(x, 1968.8, 962.30, 43.62, 0.28, 696.17, 1965.73, 503.28, 6.11, 0.02);
	x = clamp(finalColor.g, 0, white_point) / white_point;
	finalColor.g = tonemap_approx(x, 3.49, -1.76, -1.81, -0.06, 1.08, 2.57, -3.19, -0.58, -0.01);
	x = clamp(finalColor.b, 0, white_point) / white_point;
	finalColor.b = tonemap_approx(x, 2.96, -1.16, -1.98, -0.07, 0.59, 2.94, -2.97, -0.80, -0.01);
	finalColor = clamp01(finalColor);*/
#endif


	// arbitrary units
	float iso = sqrt(expo);

#if CAM_TYPE == CAM_TYPE_DIGITAL
	// digital noise (additive and subtractive, per-channel)
	// exposure affects noise directly
	float noisiness = 0.001;
	finalColor += vec4(normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness / iso), normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness / iso)).xyz;
	finalColor = clamp01(finalColor);
#else
	// film grain (multiplicative, monochromatic)
	// brightness simulates grain size, which is affected by iso
	finalColor *= 1 - max(0, normal_distribution(vec2(randomFloat(), randomFloat()), 0, min(0.5, 0.005 / iso)).x) * float(randomFloat() > 0.2);
	finalColor = clamp01(finalColor);
#endif


	//const int bitDepth = 256;
	//finalColor = round(finalColor * bitDepth) / bitDepth;

	fragColor = vec4(finalColor, 1.0);
}