// Shared typed conditional selection for shader libraries.
float selectValue(float a, float b, bool chooseB) { return chooseB ? b : a; }
int selectValue(int a, int b, bool chooseB) { return chooseB ? b : a; }
uint selectValue(uint a, uint b, bool chooseB) { return chooseB ? b : a; }
bool selectValue(bool a, bool b, bool chooseB) { return chooseB ? b : a; }
vec2 selectValue(vec2 a, vec2 b, bool chooseB) { return chooseB ? b : a; }
vec3 selectValue(vec3 a, vec3 b, bool chooseB) { return chooseB ? b : a; }
vec4 selectValue(vec4 a, vec4 b, bool chooseB) { return chooseB ? b : a; }
ivec2 selectValue(ivec2 a, ivec2 b, bool chooseB) { return chooseB ? b : a; }
ivec3 selectValue(ivec3 a, ivec3 b, bool chooseB) { return chooseB ? b : a; }
ivec4 selectValue(ivec4 a, ivec4 b, bool chooseB) { return chooseB ? b : a; }
uvec2 selectValue(uvec2 a, uvec2 b, bool chooseB) { return chooseB ? b : a; }
uvec3 selectValue(uvec3 a, uvec3 b, bool chooseB) { return chooseB ? b : a; }
uvec4 selectValue(uvec4 a, uvec4 b, bool chooseB) { return chooseB ? b : a; }
bvec2 selectValue(bvec2 a, bvec2 b, bool chooseB) { return chooseB ? b : a; }
bvec3 selectValue(bvec3 a, bvec3 b, bool chooseB) { return chooseB ? b : a; }
bvec4 selectValue(bvec4 a, bvec4 b, bool chooseB) { return chooseB ? b : a; }
vec2 selectValue(vec2 a, vec2 b, bvec2 chooseB) { return vec2(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y); }
vec3 selectValue(vec3 a, vec3 b, bvec3 chooseB) { return vec3(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z); }
vec4 selectValue(vec4 a, vec4 b, bvec4 chooseB) { return vec4(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z, chooseB.w ? b.w : a.w); }
ivec2 selectValue(ivec2 a, ivec2 b, bvec2 chooseB) { return ivec2(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y); }
ivec3 selectValue(ivec3 a, ivec3 b, bvec3 chooseB) { return ivec3(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z); }
ivec4 selectValue(ivec4 a, ivec4 b, bvec4 chooseB) { return ivec4(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z, chooseB.w ? b.w : a.w); }
uvec2 selectValue(uvec2 a, uvec2 b, bvec2 chooseB) { return uvec2(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y); }
uvec3 selectValue(uvec3 a, uvec3 b, bvec3 chooseB) { return uvec3(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z); }
uvec4 selectValue(uvec4 a, uvec4 b, bvec4 chooseB) { return uvec4(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z, chooseB.w ? b.w : a.w); }
bvec2 selectValue(bvec2 a, bvec2 b, bvec2 chooseB) { return bvec2(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y); }
bvec3 selectValue(bvec3 a, bvec3 b, bvec3 chooseB) { return bvec3(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z); }
bvec4 selectValue(bvec4 a, bvec4 b, bvec4 chooseB) { return bvec4(chooseB.x ? b.x : a.x, chooseB.y ? b.y : a.y, chooseB.z ? b.z : a.z, chooseB.w ? b.w : a.w); }
