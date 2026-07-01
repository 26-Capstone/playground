"""
Self-Healing Crawler — FastAPI 서버
실행: uvicorn api.main:app --reload --port 8000
(capstone_dataset/ 루트에서 실행)
"""
import os
import sys
import pathlib

from dotenv import load_dotenv
load_dotenv(pathlib.Path(__file__).parent.parent / ".env")

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent / "inference"))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from healer import heal_target

app = FastAPI(title="Self-Healing Crawler API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3001",   # Node.js 스크래퍼 서비스
        "http://localhost:8080",   # Spring Boot
        "http://localhost:5173",   # Vite dev server
        "http://spring-server:8080",  # Docker 내부
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealRequest(BaseModel):
    v1_html:      str
    v2_html:      str
    css_selector: str
    user_intent:  str
    target_name:  str = "타겟"


class HealResponse(BaseModel):
    status:          str   # "healed" | "no_change_needed" | "failed"
    robust_selector: str   = ""
    extracted_text:  str   = ""
    confidence:      float = 0.0
    reasoning:       str   = ""
    reason:          str   = ""  # status=failed 일 때 에러 메시지


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/heal", response_model=HealResponse)
def heal(req: HealRequest):
    try:
        result = heal_target(
            v1_html=req.v1_html,
            v2_html=req.v2_html,
            css_selector=req.css_selector,
            user_intent=req.user_intent,
            target_name=req.target_name,
        )
        return result
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"치유 실패: {e}")
