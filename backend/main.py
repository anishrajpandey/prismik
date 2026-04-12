import os
import json
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import traceback
from google.genai import types

# initialize genai client
# Will pick up GEMINI_API_KEY from environment
client = genai.Client()

@app.get("/")
def read_root():
    return {"message": "Prismik Backend is Running"}    

@app.post("/ask")
async def ask_agent(
    questionText: str = Form(...),
    canvasImage: UploadFile = File(...)
):
    """
    Returns: { "": "..." }
    """
    image_bytes = await canvasImage.read()
    
    # Using gemini-2.5-flash as it's the latest standard fast model
    model_id = "gemini-2.5-flash"
    
    system_instruction = (
        "You are Prismik, a Socratic AI tutor. "
        "Don't just give the answer; gently guide the user to find it themselves. "
        "The user is drawing on a canvas and has asked you a question. "
        "Keep your responses concise, conversational, and pedagogical."
    )
    
    prompt = f"User Question: {questionText}"
    
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=canvasImage.content_type),
                prompt
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7
            )
        )
        return {"answerText": response.text}
    except Exception as e:
        print("Error in /ask:")
        traceback.print_exc()
        return {"answerText": "I'm having trouble processing that right now."}


@app.post("/analyze-image")
async def analyze_image(
    canvasImage: UploadFile = File(...)
):
    """
    Called every 5 seconds.
    Returns: { "action": "interrupt" | "silent", "message": "..." }
    """
    image_bytes = await canvasImage.read()
    
    model_id = "gemini-2.5-flash"
    
    system_instruction = (
        "You are Prismik, a strict error checker. "
        "Look at the handwritten canvas notes for clear factual, logic, or math mistakes. "
        "If you find a REAL mistake, you must return a JSON object with `action`: 'interrupt' and a short, helpful `message` explaining the mistake softly. "
        "If there is NO clear mistake, or it's incomplete, return a JSON object with `action`: 'silent'. "
        "Respond ONLY in valid JSON format: {\"action\": \"silent\" | \"interrupt\", \"message\": \"optional message\"}"
    )
    
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=[
                types.Part.from_bytes(data=image_bytes, mime_type=canvasImage.content_type),
                "Analyze this canvas and respond exclusively in the requested JSON format."
            ],
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.1,
                response_mime_type="application/json"
            )
        )
        
        # Parse JSON from response
        text_resp = response.text.replace('```json', '').replace('```', '').strip()
        data = json.loads(text_resp)
        return data
        
    except Exception as e:
        print("Error in /analyze-image:")
        traceback.print_exc()
        return {"action": "silent"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
