import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreVertical,
  Edit2,
  Trash2,
  Camera,
  CheckCircle,
  XCircle
} from 'lucide-react';
import toast from 'react-hot-toast';
import { employeeApi } from '../services/api';
import EmployeeModal from '../components/EmployeeModal';

function Employees() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [menuOpen, setMenuOpen] = useState(null);

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const limit = 10;

  const { data, isLoading, error } = useQuery({
    queryKey: ['employees', page, search],
    queryFn: async () => {
      const res = await employeeApi.getAll({
        skip: (page - 1) * limit,
        limit,
        search: search || undefined
      });
      return res.data;
    }
  });

  const employees = data?.items || data?.employees || (Array.isArray(data) ? data : []);
  const totalCount = data?.total || employees.length;
  const totalPages = Math.ceil(totalCount / limit);

  const deleteMutation = useMutation({
    mutationFn: (id) => employeeApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['employees']);
      toast.success('Employee deleted');
    },
    onError: () => toast.error('Failed to delete employee')
  });

  const handleDelete = (employee) => {
    if (window.confirm(`Delete ${employee.full_name}?`)) {
      deleteMutation.mutate(employee.id);
    }
    setMenuOpen(null);
  };

  const handleEdit = (employee) => {
    setEditingEmployee(employee);
    setModalOpen(true);
    setMenuOpen(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Employees</h1>
          <p className="text-gray-500 mt-1">{totalCount} total employees</p>
        </div>
        <button
          onClick={() => {
            setEditingEmployee(null);
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5" />
          Add Employee
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name, email, or employee code..."
          className="w-full pl-10 pr-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          Failed to load employees: {error.message}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border overflow-visible">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Employee</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Department</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Face Status</th>
              <th className="px-6 py-4 text-left text-xs font-semibold text-gray-500">Status</th>
              <th className="px-6 py-4 text-right text-xs font-semibold text-gray-500">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">Loading...</td>
              </tr>
            ) : employees.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">No employees found</td>
              </tr>
            ) : (
              employees.map((employee) => (
                <tr key={employee.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link to={`/employees/${employee.id}`} className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">
                        {(employee.full_name || '?')[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{employee.full_name}</p>
                        <p className="text-sm text-gray-500">{employee.employee_code}</p>
                      </div>
                    </Link>
                  </td>

                  <td className="px-6 py-4">
                    <p>{employee.department || '-'}</p>
                    <p className="text-sm text-gray-500">{employee.designation || '-'}</p>
                  </td>

                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/employees/${employee.id}/face-enroll`)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${employee.has_face_template
                          ? 'bg-green-100 text-green-700'
                          : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                          }`}
                        title={employee.has_face_template ? 'Face enrolled' : 'Enroll face'}
                      >
                        <Camera className="w-3.5 h-3.5" />
                        {employee.has_face_template ? 'Enrolled' : 'Needs Enrollment'}
                      </button>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    {employee.status === 'ACTIVE' ? (
                      <span className="inline-flex items-center gap-1 text-green-600">
                        <CheckCircle className="w-4 h-4" /> Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-red-600">
                        <XCircle className="w-4 h-4" /> {employee.status || 'Inactive'}
                      </span>
                    )}
                  </td>

                  <td className="px-6 py-4 text-right">
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === employee.id ? null : employee.id)}
                        className="p-2 hover:bg-gray-100 rounded"
                      >
                        <MoreVertical className="w-5 h-5 text-gray-400" />
                      </button>

                      {menuOpen === employee.id && (
                        <div className="absolute right-0 mt-2 w-40 bg-white border rounded-lg shadow-lg z-50">
                          <button
                            onClick={() => handleEdit(employee)}
                            className="w-full px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Edit2 className="w-4 h-4" /> Edit
                          </button>
                          <button
                            onClick={() => handleDelete(employee)}
                            className="w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-4 py-4">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span className="flex items-center text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      <EmployeeModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingEmployee(null);
          queryClient.invalidateQueries(['employees']);
        }}
        employee={editingEmployee}
      />
    </div>
  );
}

export default Employees;