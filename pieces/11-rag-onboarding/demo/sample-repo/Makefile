.PHONY: setup dev test lint

setup:
	python -m pip install -r requirements.txt

dev:
	python -m orders.api --port 8087

test:
	python -m pytest -q

lint:
	python -m ruff check src tests
