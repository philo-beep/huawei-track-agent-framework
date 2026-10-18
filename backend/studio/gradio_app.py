"""Adapt the embedded framework introduction for the existing Gradio Space."""

import os

import gradio as gr

from backend.studio.app import PAGE


def introduction_html():
    document = PAGE.decode("utf-8")
    body = document.split("<body>", 1)[1].split("</body>", 1)[0]
    return body.split("<footer>", 1)[0] + "</main>"


def build_app():
    with gr.Blocks(title="华为赛道 · Agent 协作框架", analytics_enabled=False) as demo:
        gr.HTML(value=introduction_html())
    return demo


def main():
    port = int(os.environ.get("PORT", "7860"))
    if not 1 <= port <= 65535:
        raise ValueError("PORT must be between 1 and 65535")
    build_app().launch(server_name="0.0.0.0", server_port=port, share=False)


if __name__ == "__main__":
    main()
