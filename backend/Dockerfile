# syntax=docker/dockerfile:1.7
# Build context: repository root (fonts are shared with the frontend).
FROM python:3.12-slim-trixie AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg (with libass, libx264, libfreetype, harfbuzz) for cutting, rendering and burning subtitles
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements-whisper.txt ./
ARG WITH_WHISPER=1
RUN pip install -r requirements.txt \
 && if [ "$WITH_WHISPER" = "1" ]; then pip install -r requirements-whisper.txt; fi

COPY backend/app ./app
# the very same font files the browser preview uses (see scripts/fetch_fonts.py)
COPY frontend/public/fonts ./fonts

RUN useradd --create-home --uid 10001 bannerka \
 && mkdir -p /data/storage \
 && chown -R bannerka:bannerka /data
USER bannerka

ENV STORAGE_DIR=/data/storage \
    FONTS_DIR=/app/fonts \
    HF_HOME=/data/storage/models/hf

EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
