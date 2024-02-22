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

	for(int x = 0; x < size.x; x++) {
		for(int y = 0; y < size.y; y++) {
			float currentSample = frx_luminance(texelFetch(u_color, ivec2(x, y), luminanceLod).rgb);
			currentSample = min(currentSample, 2.0);

			avgLuminance += currentSample;
		}
	}

	avgLuminance /= size.x * size.y;

	float prevLuminance = texelFetch(u_previous, ivec2(0), 0).r;
	float frame_time = frx_renderSeconds - texelFetch(u_precise_uniforms, ivec2(0), 0).x;

	float smoothingFactor = clamp((prevLuminance > avgLuminance ? 0.16 : 0.24) * frame_time, 0, 1);
	if(frx_renderFrames > 1u) avgLuminance = max(0.0, mix(prevLuminance, avgLuminance, smoothingFactor));
}