.PHONY: help install test build validate

help:
	@echo "ABYX targets: install, test, build, validate"

install:
	npm ci

test:
	npm test

build:
	npm --prefix app/frontend run build

validate:
	npm run validate
