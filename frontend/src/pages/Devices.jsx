import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Monitor,
  Camera,
  Fingerprint,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2
} from 'lucide-react';
import { deviceApi } from '../services/api';

function Devices() {
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const [newDevice, setNewDevice] = useState({
    device_id: '',
    device_name: '',
    device_type: 'FACE_CAMERA',
    location: ''
  });

  /* ---------------- helpers ---------------- */
  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage({ type: '', text: '' }), 3000);
  };

  /* ---------------- fetch devices ---------------- */
  const { data: devices = [], isLoading, error } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const res = await deviceApi.getAll();
      if (Array.isArray(res.data)) return res.data;
      if (Array.isArray(res.data?.items)) return res.data.items;
      return [];
    }
  });

  /* ---------------- register device ---------------- */
  const registerMutation = useMutation({
    mutationFn: (payload) => deviceApi.register(payload),
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
      showMessage('success', 'Device registered successfully');
      setShowAddModal(false);
      setNewDevice({
        device_id: '',
        device_name: '',
        device_type: 'FACE_CAMERA',
        location: ''
      });
    },
    onError: (err) => {
      showMessage(
        'error',
        err.response?.data?.detail || 'Failed to register device'
      );
    }
  });

  /* ---------------- delete device ---------------- */
  const deleteMutation = useMutation({
    mutationFn: (id) => deviceApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
      showMessage('success', 'Device deleted');
    }
  });

  /* ---------------- activate / deactivate ---------------- */
  const activateMutation = useMutation({
    mutationFn: (id) => deviceApi.activate(id),
    onSuccess: () => queryClient.invalidateQueries(['devices'])
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => deviceApi.deactivate(id),
    onSuccess: () => queryClient.invalidateQueries(['devices'])
  });

  /* ---------------- handlers ---------------- */
  const handleAddDevice = (e) => {
    e.preventDefault();

    if (!newDevice.device_id.trim() || !newDevice.device_name.trim()) {
      showMessage('error', 'Device ID and Device Name are required');
      return;
    }

    registerMutation.mutate({
      device_id: newDevice.device_id.trim(),
      device_name: newDevice.device_name.trim(),
      device_type: newDevice.device_type,
      location: newDevice.location || null
    });
  };

  const handleDelete = (device) => {
    if (window.confirm(`Delete device "${device.device_id}"?`)) {
      deleteMutation.mutate(device.id || device.device_id);
    }
  };

  const getIcon = (type) => {
    if (type === 'FACE_CAMERA') return <Camera className="w-5 h-5" />;
    if (type === 'FINGERPRINT_SCANNER') return <Fingerprint className="w-5 h-5" />;
    return <Monitor className="w-5 h-5" />;
  };

  /* ---------------- UI ---------------- */
  return (
    <div className="space-y-6">
      {message.text && (
        <div
          className={`px-4 py-3 rounded ${
            message.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Devices</h1>
          <p className="text-gray-500">Manage biometric devices</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded"
        >
          <Plus className="w-4 h-4" />
          Add Device
        </button>
      </div>

      {error && (
        <div className="bg-red-100 text-red-700 px-4 py-3 rounded">
          Failed to load devices
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full flex justify-center py-10">
            <Loader2 className="animate-spin w-6 h-6 text-blue-600" />
          </div>
        ) : devices.length === 0 ? (
          <div className="col-span-full text-center text-gray-500 py-10">
            No devices registered yet.
          </div>
        ) : (
          devices.map((device) => (
            <div
              key={device.id}
              className="border rounded-lg p-5 bg-white"
            >
              <div className="flex justify-between mb-4">
                <div
                  className={`p-3 rounded ${
                    device.is_active
                      ? 'bg-green-100 text-green-600'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {getIcon(device.device_type)}
                </div>
                {device.is_active ? (
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                    Active
                  </span>
                ) : (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    Inactive
                  </span>
                )}
              </div>

              <h3 className="font-semibold">{device.device_name}</h3>
              <p className="text-sm text-gray-500">
                {device.device_type.replace('_', ' ')}
              </p>
              <p className="text-xs text-gray-400 mb-4">
                📍 {device.location || 'N/A'}
              </p>

              <div className="flex gap-2">
                {device.is_active ? (
                  <button
                    onClick={() => deactivateMutation.mutate(device.id)}
                    className="flex-1 text-xs bg-orange-100 text-orange-700 py-1 rounded"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    onClick={() => activateMutation.mutate(device.id)}
                    className="flex-1 text-xs bg-green-100 text-green-700 py-1 rounded"
                  >
                    Activate
                  </button>
                )}

                <button
                  onClick={() => handleDelete(device)}
                  className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Device Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-lg font-bold mb-4">Add Device</h2>

            <form onSubmit={handleAddDevice} className="space-y-4">
              <input
                className="w-full border px-3 py-2 rounded"
                placeholder="Device ID (FACE-CAM-001)"
                value={newDevice.device_id}
                onChange={(e) =>
                  setNewDevice({ ...newDevice, device_id: e.target.value })
                }
                required
              />

              <input
                className="w-full border px-3 py-2 rounded"
                placeholder="Device Name"
                value={newDevice.device_name}
                onChange={(e) =>
                  setNewDevice({ ...newDevice, device_name: e.target.value })
                }
                required
              />

              <select
                className="w-full border px-3 py-2 rounded"
                value={newDevice.device_type}
                onChange={(e) =>
                  setNewDevice({ ...newDevice, device_type: e.target.value })
                }
              >
                <option value="FACE_CAMERA">Face Recognition Camera</option>
                <option value="FINGERPRINT_SCANNER">Fingerprint Scanner</option>
              </select>

              <input
                className="w-full border px-3 py-2 rounded"
                placeholder="Location"
                value={newDevice.location}
                onChange={(e) =>
                  setNewDevice({ ...newDevice, location: e.target.value })
                }
              />

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 border py-2 rounded"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded"
                >
                  Add Device
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Devices;
