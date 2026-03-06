import { useState } from "react";
import { format } from "date-fns";
import { Download } from "lucide-react";
import api from "../services/api";

export default function Reports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const generateReport = async () => {
    if (!startDate || !endDate) {
      alert("Please select both dates");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/attendance/report", {
        params: { start_date: startDate, end_date: endDate }
      });
      // API returns { records: [...], total_records, start_date, end_date }
      const records = res.data?.records || res.data?.logs || [];
      setReport(records);
    } catch (err) {
      console.error(err);
      setError("Failed to generate report. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const safeFormatTime = (timeStr) => {
    try {
      if (!timeStr) return "-";
      const d = timeStr.includes("T")
        ? new Date(timeStr)
        : new Date(`2000-01-01T${timeStr}`);
      return format(d, "hh:mm a");
    } catch {
      return timeStr || "-";
    }
  };

  const safeFormatDate = (dateStr) => {
    try {
      if (!dateStr) return "-";
      return format(new Date(dateStr), "MMM d, yyyy");
    } catch {
      return dateStr;
    }
  };

  const handleExportCSV = () => {
    if (report.length === 0) return;

    const headers = ["Employee", "Employee Code", "Date", "Check In", "Check Out", "Working Hours", "Method"];
    const rows = report.map((item) => [
      item.employee_name || "Unknown",
      item.employee_code || "",
      item.date || "",
      item.check_in_time || "",
      item.check_out_time || "",
      item.working_hours || "",
      (item.check_in_method || "").toLowerCase(),
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-report-${startDate}-to-${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Attendance Reports</h1>

      <div className="bg-white p-6 rounded-lg shadow mb-6">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border rounded px-3 py-2"
            />
          </div>
          <button
            onClick={generateReport}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate Report"}
          </button>
          {report.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {report.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b">
            <p className="text-sm text-gray-600">
              Total records: <span className="font-semibold">{report.length}</span>
              {" | "}
              {safeFormatDate(startDate)} — {safeFormatDate(endDate)}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Employee</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Check In</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Check Out</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {report.map((item, idx) => (
                  <tr key={item.id || idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">
                        {item.employee_name || "Unknown"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.employee_code || ""}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {safeFormatDate(item.date)}
                    </td>
                    <td className="px-6 py-4 text-sm text-green-600 font-medium">
                      {safeFormatTime(item.check_in_time)}
                    </td>
                    <td className="px-6 py-4 text-sm text-red-600 font-medium">
                      {safeFormatTime(item.check_out_time)}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">
                      {item.working_hours ? `${item.working_hours} hrs` : "-"}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 capitalize">
                      {(item.check_in_method || "-").toLowerCase()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && report.length === 0 && startDate && endDate && !error && (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No records found for the selected date range.
        </div>
      )}
    </div>
  );
}