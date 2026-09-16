"""Procedural IBL matched to the new dawn gradient in world.ts."""
from pathlib import Path
import struct,zlib
W,H=1024,512
stops=[(0,(38,61,84)),(.3,(105,124,137)),(.5,(183,183,172)),(.58,(65,72,78)),(1,(35,40,45))]
rows=[]
for y in range(H):
 v=y/(H-1);a,b=next((a,b) for a,b in zip(stops,stops[1:]) if a[0]<=v<=b[0]);t=(v-a[0])/(b[0]-a[0]);rgb=tuple(round(a[1][i]*(1-t)+b[1][i]*t) for i in range(3));rows.append(b'\0'+bytes(rgb)*W)
def chunk(n,d):return struct.pack('>I',len(d))+n+d+struct.pack('>I',zlib.crc32(n+d)&0xffffffff)
p=Path(__file__).resolve().parents[3]/'build/iron-rain/environment.png';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',W,H,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b''))
