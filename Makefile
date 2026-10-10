SHELL := /bin/bash

COMPOSE ?= docker compose
API_VENV ?= $(HOME)/venvs/mlx
API_PYTHON ?= $(API_VENV)/bin/python
API_PYTEST ?= PYTHONPATH=src $(API_PYTHON) -m pytest -q
API_RUFF ?= $(API_VENV)/bin/ruff
API_MYPY ?= $(API_VENV)/bin/mypy
ADMIN_EMAIL ?= admin@example.com
ADMIN_PASSWORD ?= change-me-strong

.PHONY: help install install-web install-api dev up local-up local-build down logs reset-local smoke local-smoke test test-web test-api lint lint-web lint-api typecheck typecheck-web typecheck-shared typecheck-api check compose-config format

help:
	@awk 'BEGIN {FS = ":.*##"; printf "Speech-Machine local targets:\n"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: install-web install-api ## Install local web and API dependencies.

install-web: ## Install root npm workspaces.
	npm ci

install-api: ## Install API dependencies into API_VENV, defaulting to ~/venvs/mlx.
	cd apps/api && $(API_PYTHON) -m pip install -r requirements-dev.txt

dev: local-up ## Start the local Docker stack.

up: local-up ## Start the local Docker stack.

local-up: .env ## Start the local Docker stack with rebuilds when needed.
	$(COMPOSE) up --build

local-build: ## Build local Docker images.
	$(COMPOSE) build api worker web

down: ## Stop local Docker services.
	$(COMPOSE) down

logs: ## Follow local Docker logs.
	$(COMPOSE) logs -f api worker web

reset-local: ## Stop services and delete local Docker volumes.
	$(COMPOSE) down -v

smoke: local-smoke ## Run local endpoint smoke checks.

local-smoke: ## Check local API, setup, login, and web endpoints.
	ADMIN_EMAIL="$(ADMIN_EMAIL)" ADMIN_PASSWORD="$(ADMIN_PASSWORD)" ./scripts/local-smoke.sh

test: test-web test-api ## Run frontend and backend tests.

test-web: ## Run frontend unit tests once.
	npm --workspace apps/web test -- --run

test-api: ## Run API tests through API_VENV.
	cd apps/api && $(API_PYTEST)

lint: lint-web lint-api ## Run web and API lint checks.

lint-web: ## Run Next.js lint.
	npm --workspace apps/web run lint

lint-api: ## Run Ruff against the API.
	cd apps/api && $(API_RUFF) check .

typecheck: typecheck-shared typecheck-web typecheck-api ## Run TypeScript and Python type checks.

typecheck-web: ## Run web TypeScript check.
	npm --workspace apps/web exec tsc -- --noEmit

typecheck-shared: ## Run shared package TypeScript check.
	npm --workspace packages/shared exec tsc -- --noEmit

typecheck-api: ## Run API mypy check.
	cd apps/api && $(API_MYPY) src/app --ignore-missing-imports --no-error-summary

check: test-web typecheck-shared lint-web typecheck-web test-api lint-api typecheck-api compose-config ## Run the local pre-commit check suite.

compose-config: ## Validate Docker Compose config.
	$(COMPOSE) config >/dev/null

format: ## Format frontend files.
	npm --workspace apps/web run format

.env:
	cp .env.example .env
