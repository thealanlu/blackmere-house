"""Render the original lantern-eye emblem for browser tabs and app launchers."""
import math
import struct
import zlib
from pathlib import Path

def segment(px,py,ax,ay,bx,by):
    dx,dy=bx-ax,by-ay
    t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-ax-t*dx,py-ay-t*dy)

def emblem(x,y):
    if min(math.hypot(x-i,y-j) for i in (7,25) for j in (7,25))>6 and not (1<x<31 and 7<y<25 or 7<x<25 and 1<y<31):
        return (0,0,0,0)
    outline=[(5,15,16,5),(16,5,27,15),(8,13,8,25),(24,13,24,25),(8,25,24,25)]
    if min(segment(x,y,*line) for line in outline)<1.05:return (213,177,122,255)
    eye=abs(y-17)
    if abs(x-16)<6.5 and abs(eye-(1-((x-16)/6.5)**2)*3.2)<.73:return (228,186,130,255)
    if (x-16)**2/1.1**2+(y-17)**2/2.25**2<1:return (226,157,106,255)
    return (14,22,20,255)

def chunk(tag,data):
    return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data))

def render(size, filename, maskable=False):
    rgba=bytearray()
    for y in range(size):
        rgba.append(0)
        for x in range(size):
            scale=.63 if maskable else 1
            samples=[emblem(16+((x+(i+.5)/4)*32/size-16)/scale,16+((y+(j+.5)/4)*32/size-16)/scale)
                     for i in range(4) for j in range(4)]
            if maskable:
                samples=[v if v[3] else (14,22,20,255) for v in samples]
            n=sum(v[3]>0 for v in samples)
            rgba.extend([round(sum(v[c] for v in samples)/max(1,n)) for c in range(3)]+[round(n*255/16)])
    header=struct.pack('!2I5B',size,size,8,6,0,0,0)
    (Path(__file__).resolve().parents[1]/'dist'/'assets'/filename).write_bytes(
        b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+chunk(b'IDAT',zlib.compress(rgba,9))+chunk(b'IEND',b''))

for size in (16,32,48,192):
    render(size,f'favicon-{size}.png')
render(512,'app-512.png')
render(512,'app-maskable-512.png',True)
