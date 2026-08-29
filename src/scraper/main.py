"""
DCoderGuy — Efficient ZaubaCorp Scraper
Replaces the 2 chrome extensions with a fast, paginated scraper.
"""
import requests, csv, time, pathlib

BASE = "https://www.zaubacorp.com/companies-list/p-"

def fetch(page=1):
    url = f"{BASE}{page}-company.html"
    r = requests.get(url, timeout=15, headers={"User-Agent":"DCoderGuy/1.0"})
    return r.text if r.status_code == 200 else None

def save(data, out_path="scraped.csv"):
    with open(out_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["name","cin","address","status","paid_up"])
        w.writerows(data)
    print(f"Saved {len(data)} records to {pathlib.Path(out_path).resolve()}")
