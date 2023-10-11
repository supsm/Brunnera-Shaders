#include forgetmenot:shaders/lib/inc/header.glsl 
#include forgetmenot:shaders/lib/inc/noise.glsl 

uniform sampler2D u_color;
uniform sampler2D u_exposure;
uniform sampler2D u_depth;
uniform sampler2D u_hand_depth;

in vec2 texcoord;
in float exposure;

layout(location = 0) out vec4 fragColor;

/*struct ExposureProfile {
	float bias;
	float minExposure;
	float maxExposure;
	float exposureMultiplier;
};

ExposureProfile getOverworldExposureProfile() {
	return ExposureProfile(0.25, 0.9, 1.7, 0.75);
}
ExposureProfile getNetherExposureProfile() {
	return ExposureProfile(0.2, 1.5, 2.0, 1.0);
}
ExposureProfile getEndExposureProfile() {
	return ExposureProfile(0.2, 1.0, 1.4, 1.5);
}

ExposureProfile getExposureProfile() {
	if(frx_worldIsNether == 1) return getNetherExposureProfile();
	if(frx_worldIsEnd == 1) return getEndExposureProfile();
	return getOverworldExposureProfile();
}

float getExposureValue(const in ExposureProfile ep, const in float luminance) {
	float ev100 = log2(luminance * 100.0 * ep.bias / 12.5);
	float exposureValue = 1.0 / (1.2 * exp2(ev100));

	return clamp(exposureValue, ep.minExposure, ep.maxExposure);
}
float getExposureValue(const in float luminance) {
	return getExposureValue(getExposureProfile(), luminance);
}
float getExposureValue() {
	return getExposureValue(exposure);
}

vec3 tonemap(vec3 color) {
	float l = length(color);

	color /= l;
	color *= pow(l, 1.1);

	float exposureBias = 1.;
	color *= exposureBias;

	vec3 tmColor =  1.0 - exp(-color);

	tmColor = contrast(tmColor, 1.3);
//	tmColor = saturation(tmColor, 1.15);

	return tmColor;
}*/

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
// depth_multiplier is -1 for no checking depth
// otherwise will multiply sampled depth by depth_multiplier
// and only sample color if value is GREATER than or equal to depth at current pixel
// (use negative for less than or equal)
// last element of return value is sum of multipliers
vec4 sample_gaussian(vec2 center, float stddev, float kernel_size_stddevs = 2, vec2 step_size = vec2(1), float depth_multiplier = 0, float focus_depth = -1)
{
	vec4 default_val = vec4((focus_depth == -1 ?
			texture(u_color, center).rgb :
			texture(u_depth, center).rgb), 1);
	if (stddev == 0)
	{
		return default_val;
	}
	vec2 pixel_size = 1.0 / frxu_size;
	vec2 step_one = step_size * pixel_size;
	// log kernel size to make higher blurs use less samples
	// yes this will blur less but it's probably ok
	float kernel_size = 2 * sqrt(kernel_size_stddevs * stddev);
	// shrink kernel size to distance to edge, if necessary
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

			bool run = true;
			float sample_depth = (depth_multiplier != 0 || focus_depth != -1 ?
				texture(u_depth, vec2(i, j)).x :
				0);
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
				vec3 sample = (focus_depth == -1 ?
					texture(u_color, vec2(i, j)).rgb :
					vec3(sample_depth));
				// we can leave out 1/(stddev*sqrt(2*PI)) because constants cancel out in division
				float multiplier = exp(-0.5 * dist * dist);
				sum += sample * multiplier;
				mult_sum += multiplier;
			}
		}
	}
	if (mult_sum == 0)
	{
		return default_val;
	}
	return vec4(sum / mult_sum, mult_sum);
}

void main() {
	init();

	// TODO: don't instantly change focus, make it transition somewhat slowly
	float focus_depth = texture(u_depth, vec2(0.5)).x;
	//float pixel_depth = min(texture(u_depth, texcoord).x, texture(u_hand_depth, texcoord).x);
	// TODO: cache depth samples? sampling is very expensive
	float hand_depth = texture(u_hand_depth, texcoord).x;
	vec4 pixel_depth_info;
	// TODO: fix hand
	if (hand_depth > 0) // not part of hand
	{
		pixel_depth_info = sample_gaussian(texcoord, 4, 1.5, vec2(1.5), -1, focus_depth);
	}
	else // part of hand
	{
		pixel_depth_info = vec4(vec3(hand_depth), 1);
	} 
	float pixel_depth = pixel_depth_info.x;
	float dof_strength = 200 * abs(focus_depth - pixel_depth);
	// allow forward blending if sample took on depth of another pixel
	vec3 color = sample_gaussian(texcoord, dof_strength, 2, vec2(1.5), (pixel_depth_info.z < 0.95 || pixel_depth_info.z > 0.95 ? 1.02 : 0)).rgb;

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

	#ifdef LSD_MODE
		vec2 noise = vec2(smoothHash(texcoord * 30.0 + frx_renderSeconds * 0.1), smoothHash(texcoord * 30.0 + 1000.0 - frx_renderSeconds * 0.1)) * 0.005;

		#define texcoord (texcoord+noise)
		color.r = frx_sample13(u_color, texcoord + 0.01 * vec2(sin(frx_renderSeconds), cos(frx_renderSeconds)), 1.0 / frxu_size).r;
		color.g = frx_sample13(u_color, texcoord + 0.01 * vec2(2.0 * -sin(frx_renderSeconds + 50.0), cos(frx_renderSeconds + 50.0)), 1.0 / frxu_size).g;
		color.b = frx_sample13(u_color, texcoord + 0.01 * vec2(sin(frx_renderSeconds - 50.0), 2.0 * -cos(frx_renderSeconds - 50.0)), 1.0 / frxu_size).b;
	#endif

	vec3 finalColor = color.rgb;

	// Purkinje effect
	//float purkinjeFactor = clamp01(1.0 - exp2(-frx_luminance(finalColor * 40.0)));
	//finalColor = mix(saturation(finalColor, 0.0) * vec3(0.5, 1.2, 1.8) + 0.005, finalColor, purkinjeFactor);

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
	// linear
	//finalColor = clamp(finalColor, vec3(0), vec3(1));
	// dscs315-1
	//*
	float white_point = expo * 1600;
	float x = clamp(finalColor.r, 0, white_point) / white_point;
	finalColor.r = (-10.54 * intpow(x, 4) + 19.27 * intpow(x, 3) - 5.93 * intpow(x, 2) + 0.79 * x) /
		(-8.86 * intpow(x, 4) + 14.15 * intpow(x, 3) - 1.35 * intpow(x, 2) - 0.52 * x + 0.17);
	x = clamp(finalColor.g, 0, white_point) / white_point;
	finalColor.g = (-36.77 * intpow(x, 4) + 12.76 * intpow(x, 3) - 1.46 * intpow(x, 2)) /
		(-31 * intpow(x, 4) + 4.82 * intpow(x, 3) + 0.87 * intpow(x, 2) - 0.25 * x);
	x = clamp(finalColor.b, 0, white_point) / white_point;
	finalColor.b = (-37.3 * intpow(x, 4) + 13.34 * intpow(x, 3) - 1.63 * intpow(x, 2)) /
		(-31.03 * intpow(x, 4) + 4.62 * intpow(x, 3) + 1.05 * intpow(x, 2) - 0.31 * x);
	finalColor = clamp01(finalColor); //*/

	// arbitrary units
	float iso = sqrt(expo);

	// film grain (subtractive, monochromatic)
	// brightness simulates grain size, which is affected by iso
	//finalColor -= vec3(max(0, normal_distribution(vec2(randomFloat(), randomFloat()), max(-0.15, 0.02 / iso - 1), 0.1).x)) * float(randomFloat() > 0.4);
	//finalColor = clamp01(finalColor);

	// digital noise (additive and subtractive, per-channel)
	// exposure affects noise directly
	float noisiness = 0.001;
	finalColor += vec4(normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness / iso), normal_distribution(vec2(randomFloat(), randomFloat()), 0, noisiness / iso)).xyz;
	finalColor = clamp01(finalColor);

	//const int bitDepth = 256;
	//finalColor = round(finalColor * bitDepth) / bitDepth;

	fragColor = vec4(finalColor, 1.0);
}