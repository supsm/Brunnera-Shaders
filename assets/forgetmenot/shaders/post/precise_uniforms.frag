#include forgetmenot:shaders/lib/inc/header.glsl

in vec2 texcoord;

layout(location = 0) out float fragColor;

void main()
{
	init();

	int index = int(gl_FragCoord.x);

	float result = 0;

	switch (index)
	{
		case 0:
			result = frx_renderSeconds;
			break;
	}

	fragColor = result;
}
