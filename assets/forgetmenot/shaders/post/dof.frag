// TODO: add dof stuff to pipeline and fix chromatic aberration in final.frag
#include forgetmenot:shaders/lib/inc/header.glsl
#include forgetmenot:shaders/lib/inc/noise.glsl
#include forgetmenot:shaders/lib/inc/interlace.glsl

#include forgetmenot:cam_properties
#include forgetmenot:cam_effects

uniform sampler2D u_color;
uniform sampler2D u_downsampled;
uniform sampler2D u_depth;
uniform sampler2D u_depth_downsampled;
uniform sampler2D u_hand_depth;

in vec2 texcoord;

layout(location = 0) out vec4 fragColor;

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

#ifdef FAST_DOF
	// TODO: make this -2 part configurable
	float lod = clamp(log2(stddev) - 2, 0, 6);
	if (lod != 0)
	{
		stddev = 4; // divide stddev so transitions are smoother
		if (focus_depth == -1) { depth_multiplier = 0; } // disable depth check for color lod
	}
#else
	float lod = 0;
#endif

	// center in pixels
	vec2 center_px = center * frxu_size;
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
			float dist = distance(vec2(i, j) * frxu_size, center_px) / stddev;
			if (dist > 1) // TODO: make this check an option; without it square bokeh is produced
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
					// u_downsampled with lod=0 is just u_color with gem preprocessing
					sample = textureLod(u_downsampled, vec2(i, j), lod).rgb;
				}
				else
				{
					sample = vec3(sample_depth);
				}
				// gaussian filter
				// we can leave out 1/(stddev*sqrt(2*PI)) because constants cancel out in division
				float multiplier = exp(-0.5 * dist * dist); // TODO: prevent forward blending for bokeh somehow?
				sum += sample * multiplier;
				mult_sum += multiplier;
			}
		}
	}
	if (mult_sum == 0)
	{
		vec4 val = default_val;
		if (lod >= 1)
		{
			bool is_color = (focus_depth == -1);
			val = vec4(textureLod((is_color ? u_downsampled : u_depth_downsampled), center, lod).rgb, 1);
			if (is_color)
			{
				// fine to pow alpha since it's always 1
				val = pow(val, vec4(1 / GEM_POWER));
			}
		}
		return val;
	}
	return vec4(pow(sum / mult_sum, vec3(1 / GEM_POWER)), mult_sum);
}

void main()
{

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
		//pixel_depth_info = vec4(texture(u_depth, texcoord).xyz, 1);
	}
	else // part of hand
	{
		pixel_depth_info = vec4(vec3(hand_depth), 1);
	} 
	float pixel_depth = pixel_depth_info.x;
	// TODO: factor in aperture
	float dof_strength = min(200 * abs(focus_depth - pixel_depth), 64); // cap at 64 pixels to avoid excessive lag
	// allow forward blending (depth_multiplier = 0) if sample took on depth of another pixel (pixel_depth_info.z > 1)
	vec3 color = sample_gaussian(texcoord, dof_strength, 2, vec2(1.5), (pixel_depth_info.z < 1.05 ? 1.02 : 0)).rgb;

	fragColor = vec4(color, 1.0);
}
