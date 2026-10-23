.PHONY: help dev up down logs build test test-backend test-frontend lint fonts icons update-ytdlp whisper-model clean

help:
	@echo "make dev            — local development (Redis + API + worker + Vite)"
	@echo "make up / down      — docker compose up -d / down"
	@echo "make logs           — follow container logs"
	@echo "make test           — backend (pytest) + frontend (vitest) tests"
	@echo "make lint           — ruff + tsc"
	@echo "make fonts / icons  — regenerate subtitle fonts / PWA icons & splash screens"
	@echo "make update-ytdlp   — upgrade yt-dlp inside the running containers"
	@echo "make whisper-model  — pre-download the Whisper model into the storage volume"

dev:
	./scripts/dev.sh

up:
	@test -f .env || cp .env.example .env
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

build:
	docker compose build

test: test-backend test-frontend

test-backend:
	cd backend && python -m pytest -q

test-frontend:
	cd frontend && npm test

lint:
	cd backend && ruff check app tests
	cd frontend && npx tsc -b --noEmit

fonts:
	python3 scripts/fetch_fonts.py frontend/public/fonts

icons:
	cd frontend && npm run icons

update-ytdlp:
	docker compose exec -u root api pip install -U "yt-dlp[default,deno]"
	docker compose exec -u root worker pip install -U "yt-dlp[default,deno]"
	docker compose restart api worker

whisper-model:
	docker compose exec worker python -c "from app.worker.transcribe import _get_model; _get_model(); print('ok')"

clean:
	rm -rf frontend/dist storage
