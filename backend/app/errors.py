import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response

log = logging.getLogger(__name__)


class APIError(Exception):
    def __init__(self, status_code: int, code: str, message: str, details: object = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


class NotModified(Exception):
    def __init__(self, headers: dict[str, str]):
        self.headers = headers


def _body(code: str, message: str, details: object = None) -> dict:
    err: dict = {"code": code, "message": message}
    if details is not None:
        err["details"] = details
    return {"error": err}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(APIError)
    async def _api_error(_: Request, exc: APIError):
        return JSONResponse(_body(exc.code, exc.message, exc.details), status_code=exc.status_code)

    @app.exception_handler(NotModified)
    async def _not_modified(_: Request, exc: NotModified):
        return Response(status_code=304, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        details = [
            {"loc": list(e.get("loc", [])), "msg": e.get("msg"), "type": e.get("type")}
            for e in exc.errors()
        ]
        return JSONResponse(_body("invalid_request", "Parámetros inválidos", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("Error no controlado en %s", request.url.path)
        return JSONResponse(_body("internal_error", "Error interno del servidor"), status_code=500)
