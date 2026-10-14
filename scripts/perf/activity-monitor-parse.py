"""Parse an xctrace activity-monitor-process-live export (id/ref deduped) and print rows for matching processes."""
import sys
import xml.etree.ElementTree as ET

path, pattern = sys.argv[1], sys.argv[2]
tree = ET.parse(path)
root = tree.getroot()
schema = root.find(".//schema")
cols = [c.find("mnemonic").text for c in schema.findall("col")]
idmap = {}

def val(el):
    if el is None:
        return None
    ref = el.get("ref")
    if ref is not None:
        return idmap.get(ref)
    v = (el.get("fmt"), el.text)
    if el.get("id") is not None:
        idmap[el.get("id")] = v
    # register nested ids (e.g. pid inside process)
    for child in el.iter():
        if child is not el and child.get("id") is not None:
            idmap[child.get("id")] = (child.get("fmt"), child.text)
    return v

want = ["start", "process", "pid", "cpu-percent", "cpu-total", "memory-physical-footprint", "memory-real", "memory-compressed", "thread-count", "idle-wakeups"]
for row in root.iter("row"):
    cells = list(row)
    rec = {}
    for name, el in zip(cols, cells):
        rec[name] = val(el)
    proc = rec.get("process")
    if proc and proc[0] and pattern.lower() in proc[0].lower():
        print(" | ".join(f"{k}={rec.get(k)[0] if rec.get(k) else None}" for k in want))
