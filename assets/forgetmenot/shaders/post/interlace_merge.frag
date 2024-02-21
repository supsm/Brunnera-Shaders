#include forgetmenot:shaders/lib/inc/header.glsl
#include forgetmenot:shaders/lib/inc/space.glsl
#include forgetmenot:shaders/lib/inc/interlace.glsl

uniform sampler2D u_color;
uniform sampler2D u_previous_frame;
uniform sampler2D u_depth;
uniform sampler2D u_hand_depth;

in vec2 texcoord;

layout(location = 0) out vec4 fragColor;

void main()
{
	initGlobals();

	if (interlace_is_rendered(ivec2(gl_FragCoord.xy), frx_renderFrames))
	{
		fragColor = texture(u_color, texcoord);
	}
	else
	{
		fragColor = texture(u_previous_frame, texcoord);
	}
}
