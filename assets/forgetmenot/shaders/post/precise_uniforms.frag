#include forgetmenot:shaders/lib/inc/header.glsl

uniform sampler2D u_precise_uniforms_copy;

in vec2 texcoord;

layout(location = 0) out float fragColor;

void main()
{
	initGlobals();

	int index = int(gl_FragCoord.x);

	float result = 0;

	switch (index)
	{
		case 0:
			result = frx_renderSeconds;
			break;
		case 1:
			result = frx_renderSeconds - texelFetch(u_precise_uniforms_copy, ivec2(0, 0), 0).x;
			break;
	}

	fragColor = result;
}
