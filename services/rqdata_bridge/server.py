"""Local HTTP bridge between the TypeScript app and RQSDK/RQData."""

from __future__ import annotations

import argparse
import json
import math
import threading
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

# 指标口径必须与 app/lib/product-domain.ts 的 metricCatalog 一致。单位或周期不一致时
# 规则求值会被 RULE_UNIT_MISMATCH 拒绝，所以这里显式声明并在入口校验，而不是让错误
# 数据静默落库。
METRIC_SPECS: dict[str, tuple[str, str]] = {
    "price_close": ("CNY", "DAY"),
    "turnover": ("CNY", "DAY"),
    "nav": ("CNY", "DAY"),
    "premium_discount": ("PERCENT", "DAY"),
    "tracking_error": ("PERCENT", "MONTH"),
    "aum": ("CNY", "MONTH"),
    "revenue_yoy": ("PERCENT", "QUARTER"),
    "net_profit_yoy": ("PERCENT", "QUARTER"),
    "gross_margin": ("PERCENT", "QUARTER"),
    "operating_cash_flow": ("CNY", "QUARTER"),
}

# get_pit_financials_ex 的三大表字段。A 股财报按累计口径披露（年初至报告期末），
# 因此同比是累计同比，前值取上一年同一报告期。
FINANCIAL_FIELDS: dict[str, tuple[str, ...]] = {
    "revenue_yoy": ("revenue",),
    "net_profit_yoy": ("net_profit_parent_company",),
    "gross_margin": ("gross_profit", "revenue"),
    "operating_cash_flow": ("cash_flow_from_operating_activities",),
}

QUARTER_END = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}

# fund.get_indicators 的字段名形如 “频率_字段”，跟踪误差取近一年窗口。
TRACKING_ERROR_FIELD = "y1_tracking_error"

# RQData 衍生指标以小数比率返回，Catalog 要求 PERCENT，故换算 100 倍。接入正式许可
# 后若确认返回值已是百分数，把这里改成 1.0 即可，不需要改动其它逻辑。
RATIO_TO_PERCENT = 100.0


class RQDataService:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._initialized = False

    def initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            import rqdatac

            # rqdatac_fund 通过 export_as_api(namespace="fund") 把 fund 注册进 rqdatac，
            # 不先导入它，`from rqdatac import fund` 会 ImportError。
            import rqdatac_fund  # noqa: F401

            rqdatac.init()
            self._initialized = True

    def health(self) -> dict:
        self.initialize()
        return {
            "status": "ok",
            "provider": "rqdatac",
            "metricKeys": sorted(METRIC_SPECS),
        }

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
        spec = METRIC_SPECS.get(metric_key)
        if spec is None:
            raise ValueError(f"UNSUPPORTED_METRIC:{metric_key}")
        unit, _period = spec
        if metric_key in ("price_close", "turnover"):
            field = "close" if metric_key == "price_close" else "total_turnover"
            return self._price_series(symbol, metric_key, field, unit, start, end)
        if metric_key == "nav":
            return self._nav_series(symbol, start, end)
        if metric_key == "premium_discount":
            return self._premium_discount_series(symbol, start, end)
        if metric_key == "tracking_error":
            return self._tracking_error_series(symbol, start, end)
        if metric_key == "aum":
            return self._aum_series(symbol, start, end)
        if metric_key in FINANCIAL_FIELDS:
            return self._financial_series(symbol, metric_key, unit, start, end)
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

    def _premium_discount_series(
        self, symbol: str, start: str, end: str
    ) -> list[dict]:
        """溢折价率 = (场内收盘价 - 单位净值) / 单位净值。两条序列按交易日对齐，缺一
        边的日期直接跳过，不做前值填充——填充会让规则读到并不存在的观测。"""
        prices = {
            item["periodEnd"]: item["value"]
            for item in self._price_series(
                symbol, "price_close", "close", "CNY", start, end
            )
        }
        output: list[dict] = []
        for nav in self._nav_series(symbol, start, end):
            price = prices.get(nav["periodEnd"])
            if price is None or nav["value"] == 0:
                continue
            output.append(
                self._observation(
                    symbol,
                    "premium_discount",
                    (price - nav["value"]) / nav["value"] * RATIO_TO_PERCENT,
                    "PERCENT",
                    nav["periodEnd"],
                    nav["periodEnd"],
                )
            )
        return output

    def _tracking_error_series(
        self, symbol: str, start: str, end: str
    ) -> list[dict]:
        """跟踪误差取近一年窗口的衍生指标。RQData 按日给值，Catalog 声明的周期是
        MONTH，所以按自然月降采样保留月末一条，避免把日频数据当月度观测使用。"""
        from rqdatac import fund

        frame = fund.get_indicators(
            symbol.split(".", 1)[0],
            start_date=start,
            end_date=end,
            fields=[TRACKING_ERROR_FIELD],
        )
        monthly: dict[str, tuple[str, float]] = {}
        for period, row in self._iter_rows(frame):
            value = _finite_float(row.get(TRACKING_ERROR_FIELD))
            if value is None:
                continue
            month = period[:7]
            if month not in monthly or period > monthly[month][0]:
                monthly[month] = (period, value)
        return [
            self._observation(
                symbol,
                "tracking_error",
                value * RATIO_TO_PERCENT,
                "PERCENT",
                f"{month}-01",
                period,
            )
            for month, (period, value) in sorted(monthly.items())
        ]

    def _aum_series(self, symbol: str, start: str, end: str) -> list[dict]:
        """基金规模用份额变动表披露的期末总净资产值。这是定期报告口径，因此序列比
        月度更稀疏；宁可稀疏也不用「份额 × 净值」估算，估算值无法追溯到披露来源。"""
        from rqdatac import fund

        frame = fund.get_units_change(symbol.split(".", 1)[0])
        output: list[dict] = []
        for period, row in self._iter_rows(frame):
            if period < start or period > end:
                continue
            value = _finite_float(row.get("net_asset"))
            if value is None:
                continue
            published = _date_string(row.get("info_date")) or period
            output.append(
                self._observation(
                    symbol, "aum", value, "CNY", period, period, published
                )
            )
        return output

    def _financial_series(
        self, symbol: str, metric_key: str, unit: str, start: str, end: str
    ) -> list[dict]:
        """季度财务指标走 point-in-time 接口，并把查询日锚定在窗口右端，确保拿到的
        每一条都是当时已公告的数据，不引入未来函数。同比按累计口径与上年同一报告期
        相比。"""
        import rqdatac

        fields = list(FINANCIAL_FIELDS[metric_key])
        start_quarter = _quarter_string(start)
        end_quarter = _quarter_string(end)
        needs_prior_year = metric_key in ("revenue_yoy", "net_profit_yoy")
        query_start = (
            _shift_quarter_year(start_quarter, -1) if needs_prior_year else start_quarter
        )
        frame = rqdatac.get_pit_financials_ex(
            order_book_ids=symbol,
            fields=fields,
            start_quarter=query_start,
            end_quarter=end_quarter,
            date=end,
            statements="latest",
        )
        if frame is None or getattr(frame, "empty", True):
            return []
        by_quarter: dict[str, dict] = {}
        for index, row in frame.iterrows():
            quarter = str(index[-1] if isinstance(index, tuple) else index)
            record = row.to_dict()
            existing = by_quarter.get(quarter)
            if existing is None or _date_string(
                record.get("info_date")
            ) >= _date_string(existing.get("info_date")):
                by_quarter[quarter] = record
        output: list[dict] = []
        for quarter in sorted(by_quarter):
            if quarter < start_quarter:
                continue
            record = by_quarter[quarter]
            value = _financial_value(metric_key, record, by_quarter.get(
                _shift_quarter_year(quarter, -1)
            ))
            if value is None:
                continue
            period_start, period_end = _quarter_bounds(quarter)
            published = _date_string(record.get("info_date")) or period_end
            output.append(
                self._observation(
                    symbol,
                    metric_key,
                    value,
                    unit,
                    period_start,
                    period_end,
                    published,
                )
            )
        return output

    @staticmethod
    def _iter_rows(frame):
        """把 RQData 返回的 (order_book_id, datetime) 多级索引 DataFrame 拉平成
        (日期字符串, 行字典)。空结果统一按空序列处理。"""
        if frame is None or getattr(frame, "empty", True):
            return []
        rows = []
        for index, row in frame.iterrows():
            timestamp = index[-1] if isinstance(index, tuple) else index
            rows.append((_date_string(timestamp), row.to_dict()))
        return rows

    @staticmethod
    def _observation(
        symbol: str,
        metric_key: str,
        value: float,
        unit: str,
        period_start: str,
        period_end: str,
        published_at: str | None = None,
    ) -> dict:
        return {
            "providerRecordId": f"rqdata:{symbol}:{metric_key}:{period_end}",
            "metricKey": metric_key,
            "value": value,
            "unit": unit,
            "periodStart": period_start,
            "periodEnd": period_end,
            "publishedAt": published_at or period_end,
        }

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
    """把各种日期表示统一成 YYYY-MM-DD，无法表示时返回空串。

    pandas 的 NaT 是 datetime 的子类但 strftime 会抛 ValueError，而 get_units_change
    等接口确实会在 info_date 上给出 NaT，所以这里必须按异常兜底而不是只做类型判断。
    """
    if value is None:
        return ""
    if hasattr(value, "strftime"):
        try:
            return value.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            return ""
    text = str(value)
    if text in ("NaT", "nan", "None"):
        return ""
    return text[:10]


def _finite_float(value) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _quarter_string(day: str) -> str:
    """把 YYYY-MM-DD 折算成 RQData 的报告期字符串（如 2026q2）。"""
    parsed = datetime.strptime(day[:10], "%Y-%m-%d").date()
    return f"{parsed.year}q{(parsed.month - 1) // 3 + 1}"


def _shift_quarter_year(quarter: str, years: int) -> str:
    year, index = quarter.split("q")
    return f"{int(year) + years}q{index}"


def _quarter_bounds(quarter: str) -> tuple[str, str]:
    year, index = quarter.split("q")
    quarter_index = int(index)
    month, day = QUARTER_END[quarter_index]
    start_month = month - 2
    return (
        f"{year}-{start_month:02d}-01",
        f"{year}-{month:02d}-{day:02d}",
    )


def _financial_value(
    metric_key: str, current: dict, prior_year: dict | None
) -> float | None:
    """由三大表原始字段推导 Catalog 指标。任一输入缺失就返回 None，让上层不产生这条
    观测——缺数据必须表现为 DATA_MISSING，不能被填成 0 或前值。"""
    if metric_key == "operating_cash_flow":
        return _finite_float(current.get("cash_flow_from_operating_activities"))
    if metric_key == "gross_margin":
        gross_profit = _finite_float(current.get("gross_profit"))
        revenue = _finite_float(current.get("revenue"))
        if gross_profit is None or not revenue:
            return None
        return gross_profit / revenue * RATIO_TO_PERCENT
    field = (
        "revenue" if metric_key == "revenue_yoy" else "net_profit_parent_company"
    )
    if prior_year is None:
        return None
    now = _finite_float(current.get(field))
    before = _finite_float(prior_year.get(field))
    # 上年同期为零或负时，同比百分比没有可比口径，宁可缺失也不给误导性数字。
    if now is None or before is None or before <= 0:
        return None
    return (now - before) / before * RATIO_TO_PERCENT


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
                metric_key = query["metricKey"][0]
                # 调用方声明的周期必须与 Catalog 口径一致，否则宁可 422 也不返回一段
                # 周期错位的序列——错位的数据会让连续期规则算出假触发。
                requested_period = query.get("period", [""])[0]
                spec = METRIC_SPECS.get(metric_key)
                if spec and requested_period and requested_period != spec[1]:
                    raise ValueError(
                        f"METRIC_PERIOD_MISMATCH:{metric_key}:{spec[1]}"
                    )
                result = SERVICE.metric_series(
                    query["symbol"][0],
                    metric_key,
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
