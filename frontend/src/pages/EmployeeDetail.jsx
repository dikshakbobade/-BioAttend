import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Mail,
  Building,
  Briefcase,
  Calendar,
  Camera,
  Fingerprint,
  CheckCircle,
  XCircle
} from 'lucide-react';
import { employeeApi, attendanceApi } from '../services/api';

function EmployeeDetail() {
  const { id } = useParams();

  const { data: employee, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: async () => (await employeeApi.getById(id)).data
  });

  const { data: attendance = [] } = useQuery({
    queryKey: ['attendance', id],
    queryFn: async () => {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const res = await attendanceApi.getReport({
        employee_id: id,
        start_date: format(start, 'yyyy-MM-dd'),
        end_date: format(today, 'yyyy-MM-dd')
      });
      return res.data?.records || res.data?.logs || [];
    },
    enabled: !!id
  });

  const safeFormatTime = (timeStr) => {
    try {
      if (!timeStr) return '--:--';
      const d = timeStr.includes('T')
        ? new Date(timeStr)
        : new Date(`2000-01-01T${timeStr}`);
      return format(d, 'hh:mm a');
    } catch {
      return timeStr || '--:--';
    }
  };

  if (isLoading) return <div className="text-center py-10">Loading...</div>;
  if (!employee) return <div className="text-center py-10">Employee not found</div>;

  return (
    <div className="space-y-6">
      <Link to="/employees" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
        <ArrowLeft className="w-4 h-4" /> Back to Employees
      </Link>

      {/* Header */}
      <div className="bg-white border rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{employee.full_name}</h1>
            <p className="text-gray-500">{employee.employee_code}</p>
            <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <Mail className="w-4 h-4" /> {employee.email}
            </div>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
              <Building className="w-4 h-4" /> {employee.department}
            </div>
            {employee.designation && (
              <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                <Briefcase className="w-4 h-4" /> {employee.designation}
              </div>
            )}
          </div>
          <span
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium ${employee.status === 'ACTIVE'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
              }`}
          >
            {employee.status === 'ACTIVE' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {employee.status}
          </span>
        </div>
      </div>

      {/* Face Enrollment Status */}
      <div className="bg-white border rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${employee.has_face_template ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
              <Camera className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900">Face Recognition</h3>
              <p className={`text-sm font-medium ${employee.has_face_template ? 'text-green-600' : 'text-gray-500'}`}>
                {employee.has_face_template ? 'Biometric ID Active' : 'Enrollment Required'}
              </p>
            </div>
          </div>
          {!employee.has_face_template && (
            <Link
              to={`/employees/${employee.id}/face-enroll`}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold transition-all shadow-lg shadow-blue-600/20"
            >
              Start Enrollment
            </Link>
          )}
          {employee.has_face_template && (
            <div className="text-xs text-gray-400 font-medium bg-gray-50 px-3 py-1.5 rounded-full border">
              Security Level: High
            </div>
          )}
        </div>
      </div>

      {/* Attendance This Month */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <h2 className="font-semibold">This Month's Attendance</h2>
            <span className="text-sm text-gray-500 ml-auto">{attendance.length} records</span>
          </div>
        </div>

        {attendance.length === 0 ? (
          <div className="p-6 text-center text-gray-500">No attendance records this month</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Check In</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Check Out</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Hours</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {attendance.map((a, idx) => (
                  <tr key={a.id || idx} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-sm">
                      {format(new Date(a.date), 'MMM dd, yyyy')}
                    </td>
                    <td className="px-6 py-3 text-sm text-green-600 font-medium">
                      {safeFormatTime(a.check_in_time)}
                    </td>
                    <td className="px-6 py-3 text-sm text-red-600 font-medium">
                      {safeFormatTime(a.check_out_time)}
                    </td>
                    <td className="px-6 py-3 text-sm font-medium">
                      {a.working_hours ? `${a.working_hours} hrs` : '-'}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-1 text-xs rounded-full ${a.check_out_time
                          ? 'bg-green-100 text-green-700'
                          : 'bg-yellow-100 text-yellow-700'
                          }`}
                      >
                        {a.check_out_time ? 'Complete' : 'Working'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default EmployeeDetail;