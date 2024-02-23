#include forgetmenot:shaders/lib/inc/header.glsl 

uniform sampler2D u_color;
uniform sampler2D u_previous;
uniform sampler2D u_precise_uniforms;

in vec2 texcoord;

layout(location = 0) out float avgLuminance;

void main() {
	initGlobals();

	avgLuminance = 0.0;
	const int luminanceLod = 7;

	vec2 size = textureSize(u_color, luminanceLod);
	float totalWeight;

	for(int x = 0; x < size.x; x++) {
		for(int y = 0; y < size.y; y++) {
			float distToCenter = length(vec2(x, y) / size - 0.5);
			float currentWeight = min(0.5, (1 / distToCenter) * (1 / distToCenter));
			float currentSample = frx_luminance(texelFetch(u_color, ivec2(x, y), luminanceLod).rgb);

			avgLuminance += currentSample * currentWeight;
			totalWeight += currentWeight;

			avgLuminance += currentSample;
		}
	}

	avgLuminance /= size.x * size.y;

	avgLuminance /= totalWeight;

	float prevLuminance = texelFetch(u_previous, ivec2(0), 0).r;
	float frame_time = texelFetch(u_precise_uniforms, ivec2(1, 0), 0).x;

	float smoothingFactor = clamp((prevLuminance > avgLuminance ? 0.3 : 0.4) * frame_time, 0, 1);
	if(frx_renderFrames > 1u) avgLuminance = max(0.0, mix(prevLuminance, avgLuminance, smoothingFactor));
}