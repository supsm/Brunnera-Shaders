// preprocess for generalized mean by powing everything
#include forgetmenot:shaders/lib/inc/header.glsl
#include forgetmenot:cam_effects

uniform sampler2D u_color;

in vec2 texcoord;

layout(location = 0) out vec4 fragColor;

void main() {
	initGlobals();

	// only pow rgb, not alpha
	fragColor = vec4(pow(texture(u_color, texcoord).rgb, vec3(GEM_POWER)), 1);
}
