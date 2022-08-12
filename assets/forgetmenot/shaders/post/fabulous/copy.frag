#include forgetmenot:shaders/lib/includes.glsl 

uniform sampler2D u_composite;

in vec2 texcoord;

layout(location = 0) out vec4 fragColor;

void main() {
    vec4 composite = texture(u_composite, texcoord);
    fragColor = composite;
}