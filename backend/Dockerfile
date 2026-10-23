# Vistora backend — container image for Hugging Face Spaces (Docker SDK),
# also usable on Render, Railway, Fly.io or any Docker host.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface \
    PORT=7860 \
    # Hosting platforms put a proxy in front of the app; use the visitor's
    # address from X-Forwarded-For for per-visitor search limits.
    TRUST_PROXY_HEADERS=true

# Spaces run containers as user 1000.
RUN useradd --create-home --uid 1000 user
WORKDIR /app

# CPU-only PyTorch first (the default wheel bundles ~2 GB of CUDA libraries),
# then the rest, which keeps this torch since the versions match.
COPY requirements.txt .
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 \
    && pip install -r requirements.txt

# Bake the CLIP model into the image so the server starts without downloading.
RUN python -c "from transformers import CLIPImageProcessor, CLIPVisionModelWithProjection; \
name = 'kunalkanaujiya/clip-vit-base-patch32-vision'; \
CLIPImageProcessor.from_pretrained(name); CLIPVisionModelWithProjection.from_pretrained(name)" \
    && chown -R user:user /app

COPY --chown=user:user . .

USER user
EXPOSE 7860

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
