.PHONY: install build test lint typecheck clean pack publish

NODE_MAJOR := $(shell node -e "const m = process.version.match(/^v(\d+)/); console.log(m ? m[1] : '0')")

install:
	@echo "Checking Node.js version..."
	@if [ "$(NODE_MAJOR)" -lt 22 ]; then \
		echo "ERROR: Node.js >= 22 required (found v$(NODE_MAJOR))"; \
		exit 1; \
	fi
	@echo "Node.js $$(node --version) OK"
	@if [ ! -d node_modules ]; then \
		echo "Installing dependencies..."; \
		npm install; \
	else \
		echo "node_modules exists, skipping install."; \
	fi
	npm run build
	@test -f dist/bin/angels.js || { echo "ERROR: Build failed - dist/bin/angels.js not found"; exit 1; }
	npm install -g .

build:
	npm run build

test:
	npm test

lint:
	npm run lint

typecheck:
	npm run typecheck

clean:
	rm -rf dist

# --ignore-scripts=false re-enables lifecycle scripts disabled in .npmrc,
# so prepublishOnly (build + test) and prepack (dist check) run.
pack:
	npm pack --dry-run --ignore-scripts=false

publish:
	npm publish --ignore-scripts=false
