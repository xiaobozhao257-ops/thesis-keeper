"""Local HTTP bridge between the TypeScript app and RQSDK/RQData."""

from __future__ import annotations

import argparse
import json
import math
import threading
from datetime import date, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse


class RQDataService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._initialized = False

    def initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            import rqdatac

            rqdatac.init()
            self._initialized = True

    def health(self) -> dict:
        self.initialize()
        return {"status": "ok", "provider": "rqdatac"}

    def search_instruments(self, query: str) -> list[dict]:
        self.initialize()
        import rqdatac

        normalized = query.strip().lower()
        results: list[dict] = []
        for instrument_type in ("CS", "ETF", "LOF"):
            frame = rqdatac.all_instruments(type=instrument_type)
            for row in frame.to_dict(orient="records"):
                haystack = " ".join(
                    str(row.get(key, ""))
                    for key in ("order_book_id", "symbol", "abbrev_symbol")
                ).lower()
                if normalized and normalized not in haystack:
                    continue
                results.append(self._instrument_row(row, instrument_type))
                if len(results) >= 20:
                    return results
        return results

    def get_instrument(self, symbol: str) -> dict | None:
        self.initialize()
        import rqdatac

        instrument = rqdatac.instruments(symbol)
        if not instrument:
            return None
        row = {
            "order_book_id": getattr(instrument, "order_book_id", symbol),
            "symbol": getattr(instrument, "symbol", symbol),
            "type": getattr(instrument, "type", "CS"),
            "exchange": getattr(instrument, "exchange", ""),
        }
        return self._instrument_row(row, str(row["type"]))

    def metric_series(
        self, symbol: str, metric_key: str, start: str, end: str
    ) -> list[dict]:
        self.initialize()
        if metric_key in ("price_close", "turnover"):
            field = "close" if metric_key == "price_close" else "total_turnover"
            unit = "CNY"
            return self._price_series(symbol, metric_key, field, unit, start, end)
        if metric_key == "nav":
            return self._nav_series(symbol, start, end)
        raise ValueError(f"UNSUPPORTED_METRIC:{metric_key}")

    @staticmethod
    def _instrument_row(row: dict, instrument_type: str) -> dict:
        symbol = str(row.get("order_book_id", ""))
        exchange = str(row.get("exchange", ""))
        if not exchange:
            exchange = "XSHG" if symbol.endswith(".XSHG") else "XSHE"
        asset_type = {"CS": "EQUITY", "ETF": "ETF", "LOF": "LOF"}.get(
            instrument_type, "EQUITY"
        )
        return {
            "providerSymbol": symbol,
            "canonicalCode": symbol,
            "name": str(row.get("symbol", symbol)),
            "assetType": asset_type,
            "exchange": exchange,
            "currency": "CNY",
        }

    def _price_series(
        self,
        symbol: str,
        metric_key: str,
        field: str,
        unit: str,
        start: str,
        end: str,
    ) -> list[dict]:
        import rqdatac

        frame = rqdatac.get_price(
            symbol,
            start_date=start,
            end_date=end,
            frequency="1d",
            fields=[field],
            expect_df=True,
        )
        return self._frame_to_series(frame, symbol, metric_key, field, unit)

    def _nav_series(self, symbol: str, start: str, end: str) -> list[dict]:
        from rqdatac import fund

        fund_code = symbol.split(".", 1)[0]
        frame = fund.get_nav(
            fund_code,
            start_date=start,
            end_date=end,
            fields="unit_net_value",
            expect_df=True,
        )
        return self._frame_to_series(
            frame, symbol, "nav", "unit_net_value", "CNY"
        )

    @staticmethod
    def _frame_to_series(
        frame, symbol: str, metric_key: str, field: str, unit: str
    ) -> list[dict]:
        if frame is None or getattr(frame, "empty", True):
            return []
        if hasattr(frame, "to_frame") and not hasattr(frame, "columns"):
            frame = frame.to_frame(name=field)
        output: list[dict] = []
        for index, row in frame.iterrows():
            raw_value = row[field] if field in row else row.iloc[0]
            value = float(raw_value)
            if not math.isfinite(value):
                continue
            timestamp = index[-1] if isinstance(index, tuple) else index
            period = _date_string(timestamp)
            output.append(
                {
                    "providerRecordId": f"rqdata:{symbol}:{metric_key}:{period}",
                    "metricKey": metric_key,
                    "value": value,
                    "unit": unit,
                    "periodStart": period,
                    "periodEnd": period,
                    "publishedAt": period,
                }
            )
        return output


def _date_string(value) -> str:
    if isinstance(value, (datetime, date)):
        return value.strftime("%Y-%m-%d")
    if hasattr(value, "strftime"):
        return value.strftime("%Y-%m-%d")
    return str(value)[:10]


SERVICE = RQDataService()


class RequestHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        try:
            parsed = urlparse(self.path)
            query = parse_qs(parsed.query)
            if parsed.path == "/health":
                self._json(HTTPStatus.OK, SERVICE.health())
                return
            if parsed.path == "/instruments/search":
                self._json(
                    HTTPStatus.OK,
                    SERVICE.search_instruments(query.get("q", [""])[0]),
                )
                return
            if parsed.path.startswith("/instruments/"):
                symbol = unquote(parsed.path.removeprefix("/instruments/"))
                result = SERVICE.get_instrument(symbol)
                self._json(HTTPStatus.OK if result else HTTPStatus.NOT_FOUND, result)
                return
            if parsed.path == "/metrics":
                result = SERVICE.metric_series(
                    query["symbol"][0],
                    query["metricKey"][0],
                    query["from"][0],
                    query["to"][0],
                )
                self._json(HTTPStatus.OK, result)
                return
            self._json(HTTPStatus.NOT_FOUND, {"error": "NOT_FOUND"})
        except (KeyError, ValueError) as error:
            self._json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(error)})
        except Exception as error:  # RQSDK surfaces license/network errors here.
            self._json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": type(error).__name__, "message": str(error)},
            )

    def log_message(self, format: str, *args) -> None:
        print(f"RQData Bridge - {format % args}")

    def _json(self, status: HTTPStatus, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Thesis Keeper RQData bridge")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), RequestHandler)
    print(f"RQData Bridge listening on http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
