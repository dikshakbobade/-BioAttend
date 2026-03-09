import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Camera, CheckCircle, XCircle, Loader2, ChevronRight, UserCheck } from 'lucide-react';
import api, { employeeApi } from '../services/api';

const ENROLL_STEPS = [
  { id: 'frontal', label: 'Front View', instruction: 'Look directly at the camera with a neutral expression.' },
  { id: 'left', label: 'Left Angle', instruction: 'Turn your head slightly to the left (~30 degrees).' },
  { id: 'right', label: 'Right Angle', instruction: 'Turn your head slightly to the right (~30 degrees).' },
];

function FaceEnroll() {
  const { id: employeeId } = useParams();
  const navigate = useNavigate();

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [captured, setCaptured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [capturedBase64, setCapturedBase64] = useState(null);
  const [step, setStep] = useState('idle'); // idle, captured, failed
  const [enrolledTemplates, setEnrolledTemplates] = useState([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);

  /* ================= FETCH STATUS ================= */
  const fetchTemplates = async () => {
    try {
      const res = await employeeApi.getBiometrics(employeeId);
      const faceTemplates = res.data.filter(t => t.biometric_type === 'FACE' && t.is_active);
      setEnrolledTemplates(faceTemplates);

      // Set the next step based on how many templates we have
      if (faceTemplates.length < ENROLL_STEPS.length) {
        setCurrentStepIdx(faceTemplates.length);
      } else {
        setCurrentStepIdx(0); // Restart/Overwrite cycle
      }
    } catch (err) {
      console.error('Error fetching templates:', err);
    }
  };

  /* ================= CAMERA INIT ================= */
  useEffect(() => {
    fetchTemplates();
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        console.error('Camera error:', err);
        setCameraError('Camera access denied or not available');
      }
    };
    startCamera();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());
    };
  }, []);

  /* ================= CAPTURE ================= */
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  };

  const captureFace = () => {
    const img = captureFrame();
    if (img) {
      setCapturedBase64(img);
      setCaptured(true);
      setStep('captured');
    } else {
      alert('Failed to capture image. Please try again.');
    }
  };

  /* ================= RETAKE ================= */
  const retake = () => {
    setCaptured(false);
    setCapturedBase64(null);
    setStep('idle');
  };

  /* ================= SUBMIT ================= */
  const submitEnrollment = async () => {
    if (step !== 'captured' || loading || !capturedBase64) return;
    setLoading(true);
    try {
      await employeeApi.registerBiometric(employeeId, {
        biometric_type: 'FACE',
        template_data: capturedBase64,
        quality_score: 0, // Server will calculate
      });

      await fetchTemplates(); // Refresh count

      if (enrolledTemplates.length + 1 >= ENROLL_STEPS.length) {
        alert('Full face profile enrolled successfully!');
        navigate(`/employees/${employeeId}`);
      } else {
        // Move to next step
        setStep('idle');
        setCaptured(false);
        setCapturedBase64(null);
      }
    } catch (err) {
      console.error('Enrollment error:', err);
      let msg = 'Face enrollment failed';
      if (err.message === 'Network Error') {
        msg = 'Network Error: Cannot reach server. Please check your internet or if you are using HTTPS (https://).';
      } else if (err.response?.status === 404) {
        msg = 'API Not Found (404): The system might be incorrectly configured. Check VITE_API_URL.';
      } else {
        msg = err?.response?.data?.detail || err?.message || msg;
      }
      alert(msg);
    } finally {
      setLoading(false);
    }
  };

  /* ================= UI ================= */
  const currentStep = ENROLL_STEPS[currentStepIdx];

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Guided Face Enrollment</h1>
          <p className="text-gray-500 text-sm">Employee ID: {employeeId}</p>
        </div>
        <div className="flex gap-2">
          {ENROLL_STEPS.map((s, idx) => (
            <div
              key={s.id}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${idx < enrolledTemplates.length ? 'bg-green-500 text-white' :
                idx === currentStepIdx ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-gray-200 text-gray-500'
                }`}
            >
              {idx < enrolledTemplates.length ? '✓' : idx + 1}
            </div>
          ))}
        </div>
      </div>

      {cameraError && (
        <div className="bg-red-100 text-red-700 px-4 py-3 rounded">{cameraError}</div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Camera Feed */}
        <div className="bg-black rounded-3xl overflow-hidden relative aspect-video shadow-2xl border-4 border-gray-800">
          <video
            ref={videoRef}
            autoPlay muted playsInline
            className={`w-full h-full object-cover transition-opacity duration-300 ${captured ? 'opacity-0' : 'opacity-100'}`}
          />
          {captured && capturedBase64 && (
            <img
              src={'data:image/jpeg;base64,' + capturedBase64}
              alt="Captured"
              className="absolute inset-0 w-full h-full object-cover animate-in fade-in duration-300"
            />
          )}

          {/* Overlay Guide */}
          {!captured && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-80 border-2 border-dashed border-white/30 rounded-[120px] relative">
                <div className="absolute inset-0 border-2 border-white/10 rounded-[120px] scale-110" />
                {currentStepIdx === 1 && <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4"><ChevronRight className="text-white/50 rotate-180" /></div>}
                {currentStepIdx === 2 && <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4"><ChevronRight className="text-white/50" /></div>}
              </div>
            </div>
          )}
        </div>

        {/* Status / Preview */}
        <div className={`border-2 rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all ${step === 'captured' ? 'border-green-500/30 bg-green-50/50' : 'border-gray-100 bg-gray-50/30'
          }`}>
          <canvas ref={canvasRef} className="hidden" />

          {step === 'idle' && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
              <div className="bg-blue-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <Camera className="text-blue-600 w-10 h-10" />
              </div>
              <div>
                <p className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-1">Step {currentStepIdx + 1}: {currentStep.label}</p>
                <p className="text-gray-700 text-lg font-medium">{currentStep.instruction}</p>
              </div>
              <p className="text-gray-400 text-xs px-4">Ensure your face is well-lit and fits within the guide on the left.</p>
            </div>
          )}

          {step === 'captured' && (
            <div className="space-y-4 animate-in zoom-in-95 duration-300">
              <div className="bg-green-100 p-4 rounded-full w-20 h-20 flex items-center justify-center mx-auto">
                <UserCheck className="w-10 h-10 text-green-600" />
              </div>
              <div>
                <p className="text-green-700 font-bold text-2xl">Good Shot!</p>
                <p className="text-gray-600 text-sm mt-2">Does this look clear? If so, click confirm to save this angle.</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-3xl">
              <Loader2 className="w-12 h-12 animate-spin text-blue-600 mb-4" />
              <p className="text-blue-600 font-bold">Analyzing Quality...</p>
            </div>
          )}
        </div>
      </div>

      {/* Progress Footer */}
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
        <div className="flex items-center gap-3">
          <div className="h-2 w-48 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500"
              style={{ width: `${(enrolledTemplates.length / ENROLL_STEPS.length) * 100}%` }}
            />
          </div>
          <span className="text-xs font-bold text-gray-500 uppercase">{enrolledTemplates.length} / {ENROLL_STEPS.length} Completed</span>
        </div>

        <div className="flex gap-3">
          {step === 'idle' ? (
            <button
              onClick={captureFace}
              disabled={loading}
              className="px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 flex items-center gap-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
            >
              <Camera className="w-5 h-5" />
              Capture {currentStep.label}
            </button>
          ) : (
            <>
              <button
                onClick={retake}
                disabled={loading}
                className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all"
              >
                Retake
              </button>
              <button
                onClick={submitEnrollment}
                disabled={loading}
                className="px-8 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 flex items-center gap-2 transition-all shadow-lg shadow-green-600/20"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle className="w-5 h-5" />}
                Confirm & Next
              </button>
            </>
          )}
          <button onClick={() => navigate('/employees')} className="px-6 py-3 text-gray-500 font-medium hover:text-gray-700 transition-all">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default FaceEnroll;
