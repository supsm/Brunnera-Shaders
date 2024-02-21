#include forgetmenot:cam_effects

// check if pixel is to be rendered in current interlaced frame
bool interlace_is_rendered(ivec2 fragcoord, uint frame)
{
	// parity must equal (odd row = odd frame)
	return (uint(fragcoord.y / INTERLACE_SIZE) & 1U) == (frame & 1U);
}
