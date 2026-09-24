import struct, sys, json
def boxes(buf, start, end):
    i = start
    while i + 8 <= end:
        size, typ = struct.unpack('>I4s', buf[i:i+8]); hdr = 8
        if size == 1: size = struct.unpack('>Q', buf[i+8:i+16])[0]; hdr = 16
        elif size == 0: size = end - i
        if size < hdr: break
        yield typ.decode('latin1'), i, size, hdr
        i += size
def children(buf, b): t, s, sz, h = b; return list(boxes(buf, s + h, s + sz))
def find(buf, b, typ):
    return [c for c in children(buf, b) if c[0] == typ]
buf = open(sys.argv[1], 'rb').read()
top = list(boxes(buf, 0, len(buf)))
out = {'size': len(buf), 'top': [t for t, *_ in top], 'moofCount': sum(1 for t, *_ in top if t == 'moof'), 'fragmented': False, 'tracks': {}, 'elst': {}, 'trex': {}}
order = [t for t, *_ in top]
out['moovBeforeMdat'] = ('moov' in order and 'mdat' in order and order.index('moov') < order.index('mdat'))
for b in top:
    if b[0] == 'moov':
        mvex = find(buf, b, 'mvex'); out['fragmented'] = bool(mvex)
        for mv in mvex:
            for tx in find(buf, mv, 'trex'):
                s = tx[1] + tx[3]; tid, _, dur = struct.unpack('>III', buf[s+4:s+16]); out['trex'][tid] = {'default_sample_duration': dur}
        for trak in find(buf, b, 'trak'):
            tkhd = find(buf, trak, 'tkhd')[0]; s = tkhd[1] + tkhd[3]; v = buf[s]
            tid = struct.unpack('>I', buf[s+20:s+24])[0] if v == 1 else struct.unpack('>I', buf[s+12:s+16])[0]
            mdia = find(buf, trak, 'mdia')[0]; mdhd = find(buf, mdia, 'mdhd')[0]; s2 = mdhd[1] + mdhd[3]; v2 = buf[s2]
            ts = struct.unpack('>I', buf[s2+20:s2+24])[0] if v2 == 1 else struct.unpack('>I', buf[s2+12:s2+16])[0]
            hdlr = find(buf, mdia, 'hdlr')[0]; kind = buf[hdlr[1]+hdlr[3]+8:hdlr[1]+hdlr[3]+12].decode('latin1')
            out['tracks'][tid] = {'timescale': ts, 'kind': kind, 'frags': []}
            for edts in find(buf, trak, 'edts'):
                for elst in find(buf, edts, 'elst'):
                    s3 = elst[1] + elst[3]; v3 = buf[s3]; n = struct.unpack('>I', buf[s3+4:s3+8])[0]; p = s3 + 8; ents = []
                    for _ in range(n):
                        if v3 == 1: seg, med = struct.unpack('>Qq', buf[p:p+16]); p += 20
                        else: seg, med = struct.unpack('>Ii', buf[p:p+8]); p += 12
                        ents.append({'segment_duration': seg, 'media_time': med})
                    out['elst'][tid] = ents
for b in top:
    if b[0] != 'moof': continue
    for traf in find(buf, b, 'traf'):
        tfhd = find(buf, traf, 'tfhd')[0]; s = tfhd[1] + tfhd[3]; flags = struct.unpack('>I', buf[s:s+4])[0] & 0xffffff; tid = struct.unpack('>I', buf[s+4:s+8])[0]
        p = s + 8
        if flags & 1: p += 8
        if flags & 2: p += 4
        dsd = None
        if flags & 8: dsd = struct.unpack('>I', buf[p:p+4])[0]; p += 4
        if dsd is None: dsd = out['trex'].get(tid, {}).get('default_sample_duration')
        tfdt = find(buf, traf, 'tfdt'); bmdt = None
        if tfdt:
            s4 = tfdt[0][1] + tfdt[0][3]; v = buf[s4]; bmdt = struct.unpack('>Q', buf[s4+4:s4+12])[0] if v == 1 else struct.unpack('>I', buf[s4+4:s4+8])[0]
        total = 0; count = 0
        for trun in find(buf, traf, 'trun'):
            s5 = trun[1] + trun[3]; tf = struct.unpack('>I', buf[s5:s5+4])[0] & 0xffffff; n = struct.unpack('>I', buf[s5+4:s5+8])[0]; p = s5 + 8
            if tf & 1: p += 4
            if tf & 4: p += 4
            for _ in range(n):
                d = dsd
                if tf & 0x100: d = struct.unpack('>I', buf[p:p+4])[0]; p += 4
                if tf & 0x200: p += 4
                if tf & 0x400: p += 4
                if tf & 0x800: p += 4
                total += (d or 0); count += 1
        out['tracks'].setdefault(tid, {'timescale': None, 'kind': '?', 'frags': []})['frags'].append({'tfdt': bmdt, 'samples': count, 'dur': total})
for tid, tr in out['tracks'].items():
    fr = tr['frags']; gaps = []; ts = tr['timescale'] or 1
    for i in range(1, len(fr)):
        exp = fr[i-1]['tfdt'] + fr[i-1]['dur']; got = fr[i]['tfdt']
        if exp != got: gaps.append({'frag': i, 'expected': exp, 'got': got, 'deltaMs': round((got - exp) / ts * 1000, 3)})
    tr['fragCount'] = len(fr); tr['totalSamples'] = sum(f['samples'] for f in fr); tr['totalDurSec'] = round(sum(f['dur'] for f in fr) / ts, 4) if fr else None
    tr['firstTfdt'] = fr[0]['tfdt'] if fr else None; tr['contiguous'] = not gaps; tr['gaps'] = gaps[:10]
    tr['frags'] = fr[:6]
print(json.dumps(out))
