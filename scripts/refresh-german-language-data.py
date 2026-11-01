"""Refresh pinned offline German lookup data and factual geographic labels."""

import gzip
import hashlib
import json
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
import sys
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent / "data" / "word-language"
SPACY_REVISION = "180c5da7bead0535aee0b493910f8520bac7d966"
SPACY = f"https://raw.githubusercontent.com/explosion/spacy-lookups-data/{SPACY_REVISION}"
COUNTRIES = "https://www.auswaertiges-amt.de/resource/blob/264784/b884adc328130d148762fd146e138f99/ods-data.ods"
DEMONYMS = "https://deutsch.lingolia.com/en/vocabulary/laender-nationalitaeten"
FRANC_LICENSE = "https://raw.githubusercontent.com/wooorm/franc/3f9f0b51a96c5df32a407dad865a3011ac0fa2d1/license"


def download(url):
    request = Request(url, headers={"User-Agent": "Watchmarker language-data build"})
    with urlopen(request, timeout=30) as response:
        return response.read()


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.table = self.row = self.cell = None

    def handle_starttag(self, tag, _attrs):
        if tag == "table":
            self.table = []
        elif tag == "tr" and self.table is not None:
            self.row = []
        elif tag in ("td", "th") and self.row is not None:
            self.cell = ""

    def handle_data(self, data):
        if self.cell is not None:
            self.cell += data

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(" ".join(self.cell.split()))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == "table" and self.table is not None:
            self.tables.append(self.table)
            self.table = None


ROOT.mkdir(parents=True, exist_ok=True)
lookup = download(f"{SPACY}/spacy_lookups_data/data/de_lemma_lookup.json")
assert len(json.loads(lookup)) > 300000, "Incomplete German lemma data"
(ROOT / "de-lemma-lookup.json.gz").write_bytes(gzip.compress(lookup, mtime=0))
(ROOT / "SPACY-LOOKUPS-LICENSE.txt").write_bytes(download(f"{SPACY}/LICENSE"))
(ROOT / "FRANC-LICENSE.txt").write_bytes(download(FRANC_LICENSE))

country_source = download(COUNTRIES)
namespaces = {
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
}
with ZipFile(BytesIO(country_source)) as archive:
    tree = ET.fromstring(archive.read("content.xml"))
official = []
for row in tree.findall(".//table:table-row", namespaces):
    cells = []
    for cell in row.findall("table:table-cell", namespaces):
        text = " ".join(
            "".join(p.itertext()) for p in cell.findall("text:p", namespaces)
        ).replace("\xad", "")
        repeat = int(cell.get("{" + namespaces["table"] + "}number-columns-repeated", "1"))
        cells.extend([text] * min(repeat, 8))
    if len(cells) >= 7 and len(cells[5]) == 2:
        official.append([cells[5], *cells[:5]])
assert len(official) > 190, "Incomplete official country data"

demonym_source = download(DEMONYMS)
parser = Tables()
parser.feed(demonym_source.decode("utf-8"))
table = next(t for t in parser.tables if t[0][0] == "Country in English")
residents = [row for row in table[1:] if len(row) == 4]
assert len(residents) > 195, "Incomplete resident-name data"
(ROOT / "german-geography.json").write_text(
    json.dumps({"official": official, "residents": residents}, ensure_ascii=False,
               separators=(",", ":")) + "\n", encoding="utf-8"
)
sources = [
    (f"{SPACY}/spacy_lookups_data/data/de_lemma_lookup.json", lookup),
    (COUNTRIES, country_source),
    (DEMONYMS, demonym_source),
]
(ROOT / "sources.json").write_text(
    json.dumps([{"url": url, "sha256": hashlib.sha256(data).hexdigest()}
                for url, data in sources], indent=2) + "\n", encoding="utf-8"
)
print(f"Saved {len(json.loads(lookup))} German forms, {len(official)} country records and {len(residents)} resident records.")
sys.exit(0)
