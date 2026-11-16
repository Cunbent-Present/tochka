'use strict';
// A cut gemstone rendered by tracing rays through a convex 3D mesh.
// The small SVG marks remain as a fallback; only the membership hero uses WebGL.
(()=>{
 const host=document.querySelector('.diamond-stage');if(!host)return;
 const canvas=document.createElement('canvas');canvas.className='diamond-render';canvas.setAttribute('aria-hidden','true');
 const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true});if(!gl)return;
 const planes=[],ring=(r,y,n)=>Array.from({length:n},(_,i)=>{const a=2*Math.PI*i/n;return[r*Math.cos(a),y,r*Math.sin(a)]});
 const top=ring(.49,.48,8),girdle=ring(1,.10,16),lower=ring(.99,.045,16),tip=[0,-1.03,0];
 function face(a,b,c){const u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);let n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],l=Math.hypot(...n);n=n.map(x=>x/l);let d=n.reduce((s,x,i)=>s+x*a[i],0);if(d<0){n=n.map(x=>-x);d=-d}planes.push([...n,d]);}
 planes.push([0,1,0,.48]);
 // Eight crown mains plus sixteen star/kite facets, a thin girdle, and pavilion.
 for(let i=0;i<8;i++){const j=i*2,k=(i+1)%8;face(top[i],girdle[j],girdle[(j+1)%16]);face(top[i],girdle[(j+1)%16],top[k]);face(top[k],girdle[(j+1)%16],girdle[(j+2)%16]);}
 for(let i=0;i<16;i++){face(girdle[i],lower[i],girdle[(i+1)%16]);face(lower[i],tip,lower[(i+1)%16]);}
 const N=planes.length;
 const vert='attribute vec2 p;varying vec2 uv;void main(){uv=p;gl_Position=vec4(p,0.,1.);}';
 const frag=`precision highp float;varying vec2 uv;uniform vec4 planes[${N}];uniform mat3 rot;uniform vec2 size;uniform float dark;
 vec3 environment(vec3 d){
  float t=clamp(d.y*.5+.5,0.,1.);vec3 c=mix(vec3(.075,.11,.24),vec3(.86,.93,1.),t);
  float key=pow(max(0.,dot(d,normalize(vec3(-.65,1.,1.6)))),36.);
  float strip=smoothstep(.88,.94,dot(d,normalize(vec3(1.,.5,.7))));
  float rim=pow(max(0.,dot(d,normalize(vec3(-1.,.1,-.7)))),20.);
  float black=pow(max(0.,dot(d,normalize(vec3(.25,.3,-1.)))),12.);
  c=mix(c,vec3(.018,.03,.075),black*.92);c+=vec3(2.6)*key+vec3(1.1,1.3,1.8)*strip+vec3(.5,.75,1.3)*rim;
  return c;
 }
 bool hit(vec3 o,vec3 d,out float entry,out float leave,out vec3 en,out vec3 ex){entry=-10000.;leave=10000.;en=vec3(0.);ex=vec3(0.);
  for(int i=0;i<${N};i++){vec3 n=rot*planes[i].xyz;float den=dot(n,d);float dist=planes[i].w-dot(n,o);if(abs(den)<.00001){if(dist<0.)return false;}else{float t=dist/den;if(den<0.){if(t>entry){entry=t;en=n;}}else if(t<leave){leave=t;ex=n;}}}return entry<=leave&&leave>0.;
 }
 vec3 trace(vec3 o,vec3 d,float ior){float a,b;vec3 n,x;if(!hit(o,d,a,b,n,x))return vec3(0.);vec3 point=o+d*a;float fres=.17+.83*pow(1.-max(0.,dot(-d,n)),5.);vec3 c=environment(reflect(d,n))*fres;
  vec3 ray=refract(d,n,1./ior),pos=point+ray*.002;float energy=1.-fres;
  for(int step=0;step<6;step++){float near,far;vec3 nn,xx;if(!hit(pos,ray,near,far,nn,xx))break;pos+=ray*far;vec3 outgoing=refract(ray,-xx,ior);float f=.17+.83*pow(1.-abs(dot(ray,xx)),5.);
   energy*=exp(-far*.07);if(dot(outgoing,outgoing)>.01){c+=environment(outgoing)*energy*(1.-f);energy*=f;}
   ray=reflect(ray,xx);pos+=ray*.002;
  }c+=environment(ray)*energy*.6;return c;
 }
 void main(){vec2 q=uv;q.x*=size.x/size.y;vec3 o=vec3(0.,.15,4.5),d=normalize(vec3(q*1.33,-4.5));float a,b;vec3 n,x;if(!hit(o,d,a,b,n,x)){gl_FragColor=vec4(0.);return;}
 vec3 r=trace(o,d,2.40),g=trace(o,d,2.43),bl=trace(o,d,2.46);vec3 c=vec3(r.r,g.g,bl.b);c*=vec3(.69,.88,1.18);c=c/(c+vec3(.52));c=pow(c,vec3(.4545));gl_FragColor=vec4(c,1.);
 }`;
 function shader(type,src){const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
 try{
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vert));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,frag));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Gem shader link failed');gl.useProgram(program);
 const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(program,'p');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,2,gl.FLOAT,false,0,0);
 gl.uniform4fv(gl.getUniformLocation(program,'planes[0]'),new Float32Array(planes.flat()));
 const rotation=gl.getUniformLocation(program,'rot'),size=gl.getUniformLocation(program,'size');
 let angleX=.33,angleY=.29,raf=0;
 function draw(){raf=0;if(gl.isContextLost())return;const ratio=Math.min(devicePixelRatio||1,2);const w=Math.max(1,Math.round(host.clientWidth*ratio)),h=Math.max(1,Math.round(host.clientHeight*ratio));if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}gl.viewport(0,0,w,h);gl.uniform2f(size,w,h);
 const cx=Math.cos(angleX),sx=Math.sin(angleX),cy=Math.cos(angleY),sy=Math.sin(angleY),z=-.15,cz=Math.cos(z),sz=Math.sin(z);
 const apply=([x,y,z])=>{const xx=cy*x+sy*z,zz=-sy*x+cy*z,yy=cx*y-sx*zz,zzz=sx*y+cx*zz;return[cz*xx-sz*yy,sz*xx+cz*yy,zzz]};
 gl.uniformMatrix3fv(rotation,false,new Float32Array([[1,0,0],[0,1,0],[0,0,1]].flatMap(apply)));gl.drawArrays(gl.TRIANGLES,0,6);}
 function schedule(){if(!raf)raf=requestAnimationFrame(draw)}
 host.append(canvas);host.classList.add('has-render');new ResizeObserver(schedule).observe(host);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');host.addEventListener('pointermove',e=>{if(reduced.matches||e.pointerType==='touch')return;const r=host.getBoundingClientRect();angleY=.29+(e.clientX-r.left-r.width/2)/r.width*.5;angleX=.33+(e.clientY-r.top-r.height/2)/r.height*.25;schedule()});host.addEventListener('pointerleave',()=>{angleX=.33;angleY=.29;schedule()});
 canvas.addEventListener('webglcontextlost',()=>{host.classList.remove('has-render')});schedule();
 }catch{canvas.remove();host.classList.remove('has-render')}
})();
