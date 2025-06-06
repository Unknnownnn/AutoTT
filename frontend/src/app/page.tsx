'use client';

import { useState, useEffect } from 'react';
import CyclingTypingTitle from './components/CyclingTypingTitle';

interface Period {
  time: string;
  course_name: string;
  course_code: string;
  location: string;
}

interface DaySchedule {
  [key: string]: Period[];
}

interface UserInfo {
  success: boolean;
  authenticated: boolean;
  email?: string;
  name?: string;
  message?: string;
}

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [schedule, setSchedule] = useState<DaySchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [isRecurring, setIsRecurring] = useState(true);
  const [startDate, setStartDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authUrl, setAuthUrl] = useState<string>('');
  const [authCode, setAuthCode] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  // Define day order for sorting
  const dayOrder = {
    'MON': 0, 'TUE': 1, 'WED': 2, 'THU': 3, 'FRI': 4, 'SAT': 5, 'SUN': 6,
    'MONDAY': 0, 'TUESDAY': 1, 'WEDNESDAY': 2, 'THURSDAY': 3, 'FRIDAY': 4, 'SATURDAY': 5, 'SUNDAY': 6
  };

  // Define title animations
  const titleTexts = [
    "AutoTT", 
    "Automatic Timetable Tool", 
    "Auto TimeTable",
    "Automate Your Schedule",
    "> schedule sync"
  ];

  useEffect(() => {
    // Delete token.json and fetch user info when component mounts
    const cleanup = async () => {
      try {
        const response = await fetch('/api/cleanup', {
          method: 'POST',
        });
        if (!response.ok) {
          console.error('Failed to cleanup token file OR not Logged in');
        }
      } catch (error) {
        console.error('Error during cleanup:', error);
      }
    };

    cleanup();
    fetchUserInfo();
  }, []);

  const fetchUserInfo = async () => {
    try {
      const response = await fetch('/api/calendar-user');
      const data = await response.json();
      setUserInfo(data);
    } catch (error) {
      console.error('Failed to fetch user info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/calendar-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action: 'logout' }),
      });
      const data = await response.json();
      if (data.success) {
        setUserInfo(null);
      }
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageFile || !csvFile) {
      setError('Please select both image and CSV files');
      return;
    }

    setLoading(true);
    setError(null);
    setSyncMessage(null);

    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      formData.append('csv_file', csvFile);

      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMessage = 'Failed to process timetable';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (parseError) {
          console.error('Error parsing error response:', parseError);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      if (!data.schedule) {
        throw new Error('No schedule data received');
      }
      
      setSchedule(data.schedule);
      setError(null);
    } catch (err) {
      console.error('Processing error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process timetable');
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    
    try {
      const response = await fetch('/api/calendar-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: authCode }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to complete authentication');
      }

      if (data.success) {
        setShowAuthModal(false);
        setSyncMessage(data.message);
        // Retry the sync operation
        handleSync();
      } else {
        throw new Error(data.error || 'Authentication failed');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err instanceof Error ? err.message : 'Failed to complete authentication');
    } finally {
      setAuthLoading(false);
      setAuthCode('');
    }
  };

  const handleSync = async () => {
    if (!schedule) {
      setError('No schedule data to sync');
      return;
    }

    if (selectedDays.length === 0) {
      setError('Please select at least one day to sync');
      return;
    }

    setSyncing(true);
    setError(null);
    setSyncMessage(null);

    try {
      const formData = new FormData();
      formData.append('image', imageFile!);
      formData.append('csv_file', csvFile!);
      formData.append('sync_to_calendar', 'true');
      formData.append('selected_days', selectedDays.join(','));
      formData.append('is_recurring', isRecurring.toString());
      formData.append('start_date', startDate);

      const response = await fetch('/api/process', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync calendar');
      }

      // Check if we need authentication
      if (data.needs_auth && data.auth_url) {
        setAuthUrl(data.auth_url);
        setShowAuthModal(true);
        return;
      }

      setSyncMessage(data.message || 'Successfully synced to calendar');
      await fetchUserInfo(); // Refresh user info after successful sync
    } catch (err) {
      console.error('Sync error:', err);
      setError(err instanceof Error ? err.message : 'Failed to sync calendar');
    } finally {
      setSyncing(false);
    }
  };

  // Add this new function to start the auth flow
  const startAuth = async () => {
    try {
      setAuthLoading(true);
      const response = await fetch('/api/calendar-auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),  // Empty object for initial auth request
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start authentication');
      }

      if (data.auth_url) {
        setAuthUrl(data.auth_url);
        setShowAuthModal(true);
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start authentication');
    } finally {
      setAuthLoading(false);
    }
  };

  // File validation
  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setFile: (file: File | null) => void,
    type: 'image' | 'csv'
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFile(null);
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError(`${type === 'image' ? 'Image' : 'CSV'} file size should be less than 5MB`);
      setFile(null);
      e.target.value = '';
      return;
    }

    // Validate file type
    if (type === 'image' && !file.type.startsWith('image/')) {
      setError('Please select a valid image file');
      setFile(null);
      e.target.value = '';
      return;
    }

    if (type === 'csv' && !file.name.endsWith('.csv')) {
      setError('Please select a valid CSV file');
      setFile(null);
      e.target.value = '';
      return;
    }

    setError(null);
    setFile(file);
  };

  // Sort days when displaying them
  const sortedDays = schedule ? 
    Object.keys(schedule).sort((a, b) => (dayOrder[a as keyof typeof dayOrder] || 0) - (dayOrder[b as keyof typeof dayOrder] || 0)) : 
    [];

  // Function to navigate to the next day
  const goToNextDay = () => {
    if (schedule && sortedDays.length > 0) {
      setCurrentDayIndex((prevIndex) => (prevIndex + 1) % sortedDays.length);
    }
  };

  // Function to navigate to the previous day
  const goToPrevDay = () => {
    if (schedule && sortedDays.length > 0) {
      setCurrentDayIndex((prevIndex) => (prevIndex - 1 + sortedDays.length) % sortedDays.length);
    }
  };

  return (
    <main className="min-h-screen bg-black py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <CyclingTypingTitle 
            texts={titleTexts}
            className="text-4xl font-bold bg-gradient-to-r from-blue-500 to-blue-700 text-transparent bg-clip-text"
            typingDuration={100}
            pauseDuration={2000}
            isTypeByLetter={true}
            cursor="_"
            cursorColor="text-blue-500"
          />
        </div>

        {/* User Authentication Status */}
        <div className="mb-6">
          {isLoading ? (
            <p className="text-center text-gray-400">Loading user info...</p>
          ) : userInfo?.authenticated ? (
            <div className="flex items-center justify-between bg-[#121212] p-4 rounded-lg border border-[#3E3E3E]">
              <div>
                <p className="text-sm text-gray-400">Signed in as:</p>
                <p className="font-medium text-gray-300">{userInfo.email}</p>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm text-red-400 hover:text-red-300"
              >
                Sign Out
              </button>
            </div>
          ) : (
            <button
              onClick={startAuth}
              className="w-full bg-transparent hover:bg-[#1E3A5F] text-blue-300 px-4 py-2 rounded border border-blue-800 shadow-[0_0_15px_rgba(0,100,255,0.3)] transition-colors"
            >
              Sign in with Google Calendar
            </button>
          )}
        </div>

        {/* Auth Modal */}
        {showAuthModal && (
          <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center p-4 z-50">
            <div className="bg-[#121212] rounded-lg p-6 max-w-md w-full border border-[#3E3E3E]">
              <h3 className="text-xl font-semibold text-white mb-4">Google Calendar Authorization</h3>
              <p className="mb-4 text-gray-300">Please follow these steps:</p>
              <ol className="list-decimal list-inside mb-4 space-y-2 text-gray-300">
                <li>Click the button below to open Google&apos;s authorization page</li>
                <li>Sign in and grant access to your calendar</li>
                <li>Copy the authorization code</li>
                <li>Paste the code below and submit</li>
        </ol>

              <button
                onClick={() => window.open(authUrl, '_blank')}
                className="w-full mb-4 bg-transparent hover:bg-[#1E3A5F] text-blue-300 px-4 py-2 rounded border border-blue-800 shadow-[0_0_15px_rgba(0,100,255,0.3)] transition-colors"
              >
                Open Authorization Page
              </button>

              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label htmlFor="authCode" className="block text-sm font-medium text-gray-300">
                    Authorization Code
                  </label>
                  <input
                    type="text"
                    id="authCode"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    className="mt-1 block w-full bg-[#1A1A1A] text-gray-300 border border-[#3E3E3E] rounded-md px-3 py-2 focus:border-blue-700 focus:outline-none"
                    placeholder="Paste the authorization code here"
                    required
                  />
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowAuthModal(false)}
                    className="px-4 py-2 border border-[#3E3E3E] rounded-md text-gray-400 hover:text-gray-300 bg-transparent hover:bg-[#1A1A1A]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={authLoading || !authCode}
                    className={`px-4 py-2 rounded-md ${
                      authLoading || !authCode
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-transparent hover:bg-[#1E3A5F] text-blue-300 border border-blue-800 shadow-[0_0_15px_rgba(0,100,255,0.3)]'
                    }`}
                  >
                    {authLoading ? 'Submitting...' : 'Submit'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Error Messages */}
        {error && (
          <div className="mb-4 p-4 bg-[#2A1515] border border-red-900 text-red-400 rounded">
            {error}
          </div>
        )}

        {/* Success Messages */}
        {syncMessage && (
          <div className="mb-4 p-4 bg-[#152A15] border border-green-900 text-green-400 rounded">
            {syncMessage}
          </div>
        )}

        {/* Rest of your existing JSX */}
        <div className="bg-[linear-gradient(45deg,transparent_25%,rgba(59,130,246,0.2)_50%,transparent_75%,transparent_100%)] bg-gradient-to-b from-[#14169a] to-[#0D0D0D] relative max-w-3xl mx-auto overflow-hidden rounded-lg border border-[#3E3E3E] bg-[length:250%_250%,100%_100%] bg-[position:-100%_0,0_0] bg-no-repeat p-6 mb-8 shadow-[0_0_30px_rgba(0,80,255,0.25)] transition-[background-position_0s_ease] hover:bg-[position:200%_0,0_0] hover:duration-[1500ms]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-300 mb-2"></label>
              <div className="relative flex items-center">
                <div className={`relative w-full overflow-hidden rounded-md ${imageFile ? 'bg-[#121212]' : 'bg-transparent'} border-0 flex`}>
                  {imageFile && (
                    <div className="py-3 px-4 overflow-hidden whitespace-nowrap text-ellipsis text-gray-400 flex-grow">
                      {imageFile.name}
                    </div>
                  )}
                  <label className="cursor-pointer bg-transparent hover:bg-[#1E3A5F] text-blue-300 py-3 px-6 transition-colors duration-200 flex items-center rounded-md">
                    <span className="mr-2 text-blue-400">$</span>
                    <span className="text-blue-300 hover:text-blue-200">browse timetable image</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleFileChange(e, setImageFile, 'image')}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              {imageFile && <p className="mt-1 text-xs text-gray-500">Max file size: 5MB</p>}
            </div>

            <div className="mb-8">
              <label className="block text-sm font-medium text-gray-300 mb-2"></label>
              <div className="relative flex items-center">
                <div className={`relative w-full overflow-hidden rounded-md ${csvFile ? 'bg-[#121212]' : 'bg-transparent'} border-0 flex`}>
                  {csvFile && (
                    <div className="py-3 px-4 overflow-hidden whitespace-nowrap text-ellipsis text-gray-400 flex-grow">
                      {csvFile.name}
                    </div>
                  )}
                  <label className="cursor-pointer bg-transparent hover:bg-[#1E3A5F] text-blue-300 py-3 px-6 transition-colors duration-200 flex items-center rounded-md">
                    <span className="mr-2 text-blue-400">$</span>
                    <span className="text-blue-300 hover:text-blue-200">browse course codes csv</span>
                    <input
                      type="file"
                      accept=".csv"
                      onChange={(e) => handleFileChange(e, setCsvFile, 'csv')}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
              {csvFile && <p className="mt-1 text-xs text-gray-500">Max file size: 5MB</p>}
            </div>

            <button
              type="submit"
              disabled={loading || !imageFile || !csvFile}
              className={`w-full flex justify-center py-3 px-4 rounded-md text-sm font-medium text-white
                ${loading 
                  ? 'bg-gray-600 cursor-not-allowed' 
                  : 'bg-transparent hover:bg-[#1E3A5F] border border-blue-800'
                } transition-colors duration-200 shadow-[0_0_15px_rgba(0,100,255,0.3)]`}
            >
              {loading ? (
                <div className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </div>
              ) : <span className="flex items-center"><span className="mr-2 text-blue-400">$</span><span className="text-blue-300">process timetable</span></span>}
            </button>
          </form>
        </div>

        {schedule && (
          <>
            <div className="bg-[linear-gradient(45deg,transparent_25%,rgba(59,130,246,0.2)_50%,transparent_75%,transparent_100%)] bg-gradient-to-b from-[#14169a] to-[#0D0D0D] relative overflow-hidden rounded-lg border border-[#3E3E3E] bg-[length:250%_250%,100%_100%] bg-[position:-100%_0,0_0] bg-no-repeat p-6 mb-8 shadow-[0_0_30px_rgba(0,80,255,0.25)] transition-[background-position_0s_ease] hover:bg-[position:200%_0,0_0] hover:duration-[1500ms]">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-white">Schedule</h2>
              </div>

              {/* Calendar Sync Options */}
              <div className="bg-[linear-gradient(45deg,transparent_25%,rgba(59,130,246,0.2)_50%,transparent_75%,transparent_100%)] bg-gradient-to-b from-[#14169a] to-[#0D0D0D] relative overflow-hidden rounded-lg border border-[#3E3E3E] bg-[length:250%_250%,100%_100%] bg-[position:-100%_0,0_0] bg-no-repeat p-6 mb-6 shadow-[0_0_30px_rgba(0,80,255,0.25)] transition-[background-position_0s_ease] hover:bg-[position:200%_0,0_0] hover:duration-[1500ms]">
                <h3 className="text-lg font-semibold text-white mb-4">Calendar Sync Options</h3>
                
                {/* Event Type Selection */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    <span className="text-blue-400 mr-2">$</span>
                    <span>event-type</span>
                  </label>
                  <div className="flex gap-6 pl-6">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="radio"
                        className="form-radio hidden"
                        name="eventType"
                        checked={isRecurring}
                        onChange={() => setIsRecurring(true)}
                      />
                      <span className={`flex items-center ${isRecurring ? 'text-blue-300' : 'text-gray-400'}`}>
                        <span className="mr-2">{isRecurring ? '>' : ' '}</span>
                        recurring-weekly
                      </span>
                    </label>
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="radio"
                        className="form-radio hidden"
                        name="eventType"
                        checked={!isRecurring}
                        onChange={() => setIsRecurring(false)}
                      />
                      <span className={`flex items-center ${!isRecurring ? 'text-blue-300' : 'text-gray-400'}`}>
                        <span className="mr-2">{!isRecurring ? '>' : ' '}</span>
                        one-time
                      </span>
                    </label>
                  </div>
                </div>

                {/* Start Date Selection */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    <span className="text-blue-400 mr-2">$</span>
                    <span>start-date</span>
                  </label>
                  <div className="pl-6">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="bg-transparent text-blue-300 border border-[#3E3E3E] rounded-md px-3 py-2 focus:border-blue-700 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Day Selection */}
                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-300 mb-3">
                    <span className="text-blue-400 mr-2">$</span>
                    <span>select-days</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pl-6">
                    {sortedDays.map((day) => (
                      <label key={day} className="inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          className="form-checkbox hidden"
                          checked={selectedDays.includes(day)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedDays([...selectedDays, day]);
                            } else {
                              setSelectedDays(selectedDays.filter(d => d !== day));
                            }
                          }}
                        />
                        <span className={`flex items-center ${selectedDays.includes(day) ? 'text-blue-300' : 'text-gray-400'}`}>
                          <span className="mr-2">{selectedDays.includes(day) ? '[x]' : '[ ]'}</span>
                          {day}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Sync Button */}
                <button
                  onClick={handleSync}
                  disabled={syncing || selectedDays.length === 0}
                  className={`w-full flex justify-center py-3 px-4 rounded-md text-sm font-medium
                    ${syncing || selectedDays.length === 0
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
                      : 'bg-transparent hover:bg-[#1E3A5F] text-blue-300 border border-blue-800 shadow-[0_0_15px_rgba(0,100,255,0.3)]'
                    } transition-colors duration-200`}
                >
                  {syncing ? (
                    <div className="flex items-center justify-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Syncing to Calendar...
                    </div>
                  ) : <span className="flex items-center"><span className="mr-2 text-blue-400">$</span><span>sync-to-calendar</span></span>}
                </button>
              </div>

              {syncMessage && (
                <div className="mb-6 p-4 bg-[#121212] rounded-md border border-[#3E3E3E] text-blue-300 whitespace-pre-line">
                  <p className="text-sm"><span className="text-blue-400">$</span> {syncMessage}</p>
                </div>
              )}

              {/* Schedule Display */}
              {sortedDays.length > 0 && (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <button 
                      onClick={goToPrevDay} 
                      className="text-blue-400 hover:text-blue-300 p-2 focus:outline-none flex items-center"
                      aria-label="Previous day"
                    >
                      <span className="mr-1">$</span>
                      <span>prev</span>
                    </button>
                    
                    <h3 className="text-xl font-semibold text-white">
                      <span className="text-blue-400 mr-2">$</span>
                      <span>{sortedDays[currentDayIndex]}</span>
                      <span className="ml-2 text-gray-400 text-sm">{currentDayIndex + 1}/{sortedDays.length}</span>
                    </h3>
                    
                    <button 
                      onClick={goToNextDay} 
                      className="text-blue-400 hover:text-blue-300 p-2 focus:outline-none flex items-center"
                      aria-label="Next day"
                    >
                      <span className="mr-1">$</span>
                      <span>next</span>
                    </button>
                  </div>
                  
                  <div className="bg-[#121212] p-5 rounded-lg border border-[#3E3E3E]">
                    {(() => {
                      const day = sortedDays[currentDayIndex];
                      const periodsArray = Array.isArray(schedule?.[day]) ? schedule[day] : [];
                      
                      return periodsArray.length > 0 ? (
                        <div className="space-y-4">
                          {periodsArray.map((period, index) => (
                            <div 
                              key={`${day}-${index}`} 
                              className="p-4 border-l-2 border-blue-800 pl-4"
                            >
                              <p className="text-sm font-medium text-blue-300">
                                <span className="text-blue-400 mr-2">{'>'}</span>
                                Time: {period.time || 'Not specified'}
                              </p>
                              <p className="text-sm text-gray-400 ml-4">
                                Course: {period.course_name || 'Not specified'}
                              </p>
                              <p className="text-sm text-gray-400 ml-4">
                                Location: {period.location || 'Not specified'}
                              </p>
                              <p className="text-xs text-gray-500 ml-4">
                                Code: {period.course_code || 'Not specified'}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400"><span className="text-blue-400 mr-2">{'>'}</span>No periods scheduled for this day</p>
                      );
                    })()}
                  </div>
                  
                  <div className="flex justify-center mt-4">
                    <div className="flex space-x-2">
                      {sortedDays.map((day, index) => (
                        <button
                          key={day}
                          onClick={() => setCurrentDayIndex(index)}
                          className={`w-2 h-2 rounded-full ${
                            currentDayIndex === index ? 'bg-blue-500' : 'bg-gray-600'
                          }`}
                          aria-label={`Go to ${day}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
    </div>
    </main>
  );
}
