"""
Единая точка доступа к OpenAI-совместимому API.
Поддерживается OpenAI и NeuroAPI (https://neuroapi.host) — без VPN.
Все агенты используют get_client() / get_model() / get_image_model().
"""
import os
from openai import OpenAI

NEUROAPI_BASE_URL = "https://neuroapi.host/v1"


def _use_neuroapi() -> bool:
    return bool(os.environ.get("NEUROAPI_API_KEY"))


def get_api_key() -> str:
    if _use_neuroapi():
        key = os.environ.get("NEUROAPI_API_KEY")
        if not key:
            raise ValueError("NEUROAPI_API_KEY is not set")
        return key
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise ValueError("OPENAI_API_KEY is not set (или задайте NEUROAPI_API_KEY для NeuroAPI)")
    return key


def get_client() -> OpenAI:
    if _use_neuroapi():
        return OpenAI(base_url=NEUROAPI_BASE_URL, api_key=get_api_key())
    return OpenAI(api_key=get_api_key())

def get_model() -> str:
    return os.environ.get("OPENAI_MODEL", "gpt-5.1")

def get_image_model() -> str:
    return os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
