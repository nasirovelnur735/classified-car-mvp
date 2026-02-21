"""
Единая точка доступа к OpenAI: api_key везде берётся из OPENAI_API_KEY и передаётся явно в клиент.
Все агенты используют get_client() / get_model() / get_image_model().
"""
import os
from openai import OpenAI

def get_api_key() -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY is not set")
    return api_key

def get_client() -> OpenAI:
    return OpenAI(api_key=get_api_key())

def get_model() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-5.1")

def get_image_model() -> str:
    return os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
