#!/bin/bash
# DCoderGuy VPS deploy — runs scraper + serves site on 161.118.168.179
python3 -m http.server 8080 --directory . &
echo "DCoderGuy running on port 8080 (use nginx/reverse proxy for 80)"
