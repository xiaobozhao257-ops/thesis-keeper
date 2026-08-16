"""RQData Bridge 指标口径测试。

不连接真实 RQData：用假的 rqdatac 模块和假 DataFrame 注入，只验证口径换算、
报告期折算、point-in-time 取数和缺失处理。真实许可下的连通性由 /health 验证。

运行：.venv-rqdata/bin/python -m unittest discover -s tests -p "test_*.py"
"""

from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "rqdata_bridge_server", ROOT / "services" / "rqdata_bridge" / "server.py"
)
bridge = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bridge)


def pit_frame(rows: list[dict]) -> pd.DataFrame:
    """构造 get_pit_financials_ex 形状的结果：(order_book_id, quarter) 多级索引。"""
    frame = pd.DataFrame(rows)
    return frame.set_index(["order_book_id", "quarter"])


class QuarterHelperTest(unittest.TestCase):
    def test_quarter_string_maps_any_day_to_its_report_period(self) -> None:
        self.assertEqual(bridge._quarter_string("2026-01-01"), "2026q1")
        self.assertEqual(bridge._quarter_string("2026-03-31"), "2026q1")
        self.assertEqual(bridge._quarter_string("2026-06-30"), "2026q2")
        self.assertEqual(bridge._quarter_string("2026-12-31"), "2026q4")

    def test_quarter_bounds_cover_the_full_calendar_quarter(self) -> None:
        self.assertEqual(bridge._quarter_bounds("2026q1"), ("2026-01-01", "2026-03-31"))
        self.assertEqual(bridge._quarter_bounds("2026q2"), ("2026-04-01", "2026-06-30"))
        self.assertEqual(bridge._quarter_bounds("2026q3"), ("2026-07-01", "2026-09-30"))
        self.assertEqual(bridge._quarter_bounds("2026q4"), ("2026-10-01", "2026-12-31"))

    def test_shift_quarter_year_keeps_the_same_report_period(self) -> None:
        self.assertEqual(bridge._shift_quarter_year("2026q2", -1), "2025q2")
        self.assertEqual(bridge._shift_quarter_year("2026q4", -1), "2025q4")


class MissingValueTest(unittest.TestCase):
    def test_finite_float_rejects_none_nan_and_garbage(self) -> None:
        self.assertIsNone(bridge._finite_float(None))
        self.assertIsNone(bridge._finite_float(float("nan")))
        self.assertIsNone(bridge._finite_float(float("inf")))
        self.assertIsNone(bridge._finite_float("not-a-number"))
        self.assertEqual(bridge._finite_float("3.5"), 3.5)

    def test_date_string_normalizes_missing_timestamps_to_empty(self) -> None:
        self.assertEqual(bridge._date_string(None), "")
        self.assertEqual(bridge._date_string(pd.NaT), "")
        self.assertEqual(bridge._date_string(pd.Timestamp("2026-04-30")), "2026-04-30")


class FinancialValueTest(unittest.TestCase):
    def test_revenue_yoy_uses_the_same_period_of_the_prior_year(self) -> None:
        value = bridge._financial_value(
            "revenue_yoy", {"revenue": 1170.0}, {"revenue": 1000.0}
        )
        self.assertAlmostEqual(value, 17.0)

    def test_yoy_is_missing_rather_than_wrong_without_a_comparable_base(self) -> None:
        self.assertIsNone(
            bridge._financial_value("revenue_yoy", {"revenue": 1170.0}, None)
        )
        self.assertIsNone(
            bridge._financial_value("revenue_yoy", {"revenue": 1170.0}, {"revenue": 0.0})
        )
        # 上年同期亏损时百分比同比没有可比口径。
        self.assertIsNone(
            bridge._financial_value(
                "net_profit_yoy",
                {"net_profit_parent_company": 10.0},
                {"net_profit_parent_company": -20.0},
            )
        )

    def test_gross_margin_and_cash_flow_read_the_three_statements_directly(self) -> None:
        self.assertEqual(
            bridge._financial_value(
                "gross_margin", {"gross_profit": 42.0, "revenue": 100.0}, None
            ),
            42.0,
        )
        self.assertIsNone(
            bridge._financial_value(
                "gross_margin", {"gross_profit": 42.0, "revenue": 0.0}, None
            )
        )
        self.assertEqual(
            bridge._financial_value(
                "operating_cash_flow",
                {"cash_flow_from_operating_activities": 8.8e8},
                None,
            ),
            8.8e8,
        )
        self.assertIsNone(bridge._financial_value("operating_cash_flow", {}, None))


class MetricSpecTest(unittest.TestCase):
    def test_specs_match_the_typescript_metric_catalog(self) -> None:
        catalog = (ROOT / "app" / "lib" / "product-domain.ts").read_text(
            encoding="utf-8"
        )
        for metric_key, (unit, period) in bridge.METRIC_SPECS.items():
            if metric_key == "price_close":
                continue  # 价格快照不在 metricCatalog 里，只用于决策快照。
            self.assertIn(
                f'key: "{metric_key}"',
                catalog,
                f"{metric_key} 不在 metricCatalog 中",
            )
            entry = catalog[catalog.index(f'key: "{metric_key}"') :]
            entry = entry[: entry.index("}")]
            self.assertIn(f'unit: "{unit}"', entry, metric_key)
            self.assertIn(f'period: "{period}"', entry, metric_key)

    def test_unsupported_metric_is_rejected_before_any_rqdata_call(self) -> None:
        service = bridge.RQDataService()
        service._initialized = True
        with self.assertRaises(ValueError) as raised:
            service.metric_series("600000.XSHG", "pe_ratio", "2026-01-01", "2026-06-30")
        self.assertIn("UNSUPPORTED_METRIC", str(raised.exception))


class StubbedSeriesTest(unittest.TestCase):
    """用假 rqdatac / fund 模块验证序列拼装，不触碰真实许可。"""

    def setUp(self) -> None:
        self.calls: dict[str, dict] = {}
        self._saved = {
            name: sys.modules.get(name) for name in ("rqdatac", "rqdatac_fund")
        }
        fund = types.SimpleNamespace(
            get_nav=self._fake_get_nav,
            get_indicators=self._fake_get_indicators,
            get_units_change=self._fake_get_units_change,
        )
        rqdatac = types.ModuleType("rqdatac")
        rqdatac.fund = fund
        rqdatac.get_price = self._fake_get_price
        rqdatac.get_pit_financials_ex = self._fake_pit
        rqdatac.init = lambda *args, **kwargs: None
        sys.modules["rqdatac"] = rqdatac
        sys.modules["rqdatac_fund"] = types.ModuleType("rqdatac_fund")
        self.service = bridge.RQDataService()
        self.service._initialized = True

    def tearDown(self) -> None:
        for name, module in self._saved.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    def _fake_get_price(self, symbol, **kwargs):
        index = pd.MultiIndex.from_tuples(
            [(symbol, pd.Timestamp("2026-06-29")), (symbol, pd.Timestamp("2026-06-30"))]
        )
        return pd.DataFrame({"close": [1.10, 1.05]}, index=index)

    def _fake_get_nav(self, code, **kwargs):
        index = pd.MultiIndex.from_tuples(
            [(code, pd.Timestamp("2026-06-30")), (code, pd.Timestamp("2026-07-01"))]
        )
        return pd.DataFrame({"unit_net_value": [1.00, 1.02]}, index=index)

    def _fake_get_indicators(self, code, **kwargs):
        self.calls["indicators"] = kwargs
        index = pd.MultiIndex.from_tuples(
            [
                (code, pd.Timestamp("2026-05-29")),
                (code, pd.Timestamp("2026-06-15")),
                (code, pd.Timestamp("2026-06-30")),
            ]
        )
        return pd.DataFrame(
            {bridge.TRACKING_ERROR_FIELD: [0.012, 0.018, 0.021]}, index=index
        )

    def _fake_get_units_change(self, code, **kwargs):
        index = pd.MultiIndex.from_tuples(
            [
                (code, pd.Timestamp("2025-12-31")),
                (code, pd.Timestamp("2026-06-30")),
            ]
        )
        return pd.DataFrame(
            {
                "net_asset": [1.0e9, 1.2e9],
                "info_date": [pd.Timestamp("2026-01-20"), pd.Timestamp("2026-07-18")],
            },
            index=index,
        )

    def _fake_pit(self, **kwargs):
        self.calls["pit"] = kwargs
        return pit_frame(
            [
                {
                    "order_book_id": "600000.XSHG",
                    "quarter": "2025q2",
                    "revenue": 1000.0,
                    "info_date": pd.Timestamp("2025-08-20"),
                },
                {
                    "order_book_id": "600000.XSHG",
                    "quarter": "2026q2",
                    "revenue": 1170.0,
                    "info_date": pd.Timestamp("2026-08-11"),
                },
            ]
        )

    def test_premium_discount_only_uses_days_present_in_both_series(self) -> None:
        series = self.service.metric_series(
            "510300.XSHG", "premium_discount", "2026-06-01", "2026-07-01"
        )
        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["periodEnd"], "2026-06-30")
        self.assertEqual(series[0]["unit"], "PERCENT")
        self.assertAlmostEqual(series[0]["value"], 5.0)

    def test_tracking_error_is_downsampled_to_one_month_end_observation(self) -> None:
        series = self.service.metric_series(
            "510300.XSHG", "tracking_error", "2026-05-01", "2026-06-30"
        )
        self.assertEqual([item["periodEnd"] for item in series], ["2026-05-29", "2026-06-30"])
        self.assertEqual(series[1]["periodStart"], "2026-06-01")
        self.assertAlmostEqual(series[1]["value"], 2.1)
        self.assertEqual(series[1]["unit"], "PERCENT")

    def test_aum_filters_to_the_window_and_keeps_the_disclosure_date(self) -> None:
        series = self.service.metric_series(
            "510300.XSHG", "aum", "2026-01-01", "2026-12-31"
        )
        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["periodEnd"], "2026-06-30")
        self.assertEqual(series[0]["publishedAt"], "2026-07-18")
        self.assertEqual(series[0]["value"], 1.2e9)

    def test_financial_series_anchors_point_in_time_and_drops_the_base_quarter(
        self,
    ) -> None:
        series = self.service.metric_series(
            "600000.XSHG", "revenue_yoy", "2026-04-01", "2026-06-30"
        )
        # 查询窗口向前多取一年用于同比，但只返回落在请求区间内的报告期。
        self.assertEqual(self.calls["pit"]["start_quarter"], "2025q2")
        self.assertEqual(self.calls["pit"]["end_quarter"], "2026q2")
        self.assertEqual(self.calls["pit"]["date"], "2026-06-30")
        self.assertEqual(self.calls["pit"]["statements"], "latest")
        self.assertEqual(len(series), 1)
        self.assertEqual(series[0]["periodStart"], "2026-04-01")
        self.assertEqual(series[0]["periodEnd"], "2026-06-30")
        self.assertEqual(series[0]["publishedAt"], "2026-08-11")
        self.assertAlmostEqual(series[0]["value"], 17.0)
        self.assertEqual(series[0]["unit"], "PERCENT")


if __name__ == "__main__":
    unittest.main()
