import { useState } from 'react';

export default function ContactForm() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSell, setIsSell] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    phone_number: '',
    email: '',
    car_name: '',
    location: '',
  });
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleActionSelect = (action: 'buy' | 'sell') => {
    setIsSell(action === 'sell');
    setCurrentStep(2);
  };

  const handleBack = () => {
    setCurrentStep(1);
    setMessage(null);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const token = 'qbxm2tn9';
    const data = {
      name: formData.name,
      phone_number: formData.phone_number,
      email: formData.email || null,
      car_name: formData.car_name || null,
      location: formData.location || null,
      is_sell: isSell,
    };

    try {
      const response = await fetch(
        'https://api.indianluxurycars.com/rest/contact_form',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(data),
        }
      );

      const result = await response.json();

      if (response.ok && result.message === 'Resource created successfully') {
        setMessage({
          type: 'success',
          text: 'Thank you! We will contact you soon.',
        });
        setFormData({
          name: '',
          phone_number: '',
          email: '',
          car_name: '',
          location: '',
        });
        setTimeout(() => {
          handleBack();
        }, 2000);
      } else {
        throw new Error(result.error || 'Failed to submit form');
      }
    } catch (error: any) {
      setMessage({
        type: 'error',
        text: error.message || 'Something went wrong. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='mt-12 bg-[#0a0c14] border border-white/10 rounded-2xl shadow-2xl p-8 overflow-hidden backdrop-blur-xl'>
      <div className='flex items-center justify-center gap-2 mb-8'>
        <div
          className={`w-3 h-3 rounded-full transition-all ${
            currentStep >= 1 ? 'bg-amber-500' : 'bg-white/10'
          }`}
        />
        <div
          className={`w-12 h-0.5 transition-all ${
            currentStep >= 2 ? 'bg-amber-500' : 'bg-white/10'
          }`}
        />
        <div
          className={`w-3 h-3 rounded-full transition-all ${
            currentStep >= 2 ? 'bg-amber-500' : 'bg-white/10'
          }`}
        />
      </div>

      <form onSubmit={handleSubmit} className='space-y-6'>
        {currentStep === 1 && (
          <div>
            <h2 className='text-2xl font-serif text-white mb-6 text-center'>
              What would you like to do?
            </h2>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mb-6'>
              <button
                type='button'
                onClick={() => handleActionSelect('buy')}
                className='action-btn px-8 py-6 bg-white/5 border-2 border-white/10 rounded-xl text-white hover:border-amber-500/50 hover:bg-white/10 transition-all text-left group'
              >
                <div className='flex items-center gap-4'>
                  <div className='w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/30 transition-all'>
                    <svg
                      className='w-6 h-6 text-amber-400'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='2'
                        d='M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
                      />
                    </svg>
                  </div>
                  <div>
                    <div className='font-bold text-lg mb-1'>Buy a Car</div>
                    <div className='text-sm text-white/60'>
                      Find your dream luxury car
                    </div>
                  </div>
                </div>
              </button>
              <button
                type='button'
                onClick={() => handleActionSelect('sell')}
                className='action-btn px-8 py-6 bg-white/5 border-2 border-white/10 rounded-xl text-white hover:border-amber-500/50 hover:bg-white/10 transition-all text-left group'
              >
                <div className='flex items-center gap-4'>
                  <div className='w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center group-hover:bg-amber-500/30 transition-all'>
                    <svg
                      className='w-6 h-6 text-amber-400'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path
                        strokeLinecap='round'
                        strokeLinejoin='round'
                        strokeWidth='2'
                        d='M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                      />
                    </svg>
                  </div>
                  <div>
                    <div className='font-bold text-lg mb-1'>Sell a Car</div>
                    <div className='text-sm text-white/60'>
                      Get the best price for your car
                    </div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div>
            <h2 className='text-2xl font-serif text-white mb-6 text-center'>
              {isSell
                ? 'Tell us about your car'
                : "Tell us what you're looking for"}
            </h2>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-6 space-y-6 md:space-y-0'>
              <div>
                <label
                  htmlFor='name'
                  className='block text-sm font-medium text-white/90 my-2'
                >
                  Name <span className='text-red-400'>*</span>
                </label>
                <input
                  type='text'
                  id='name'
                  name='name'
                  required
                  value={formData.name}
                  onChange={handleInputChange}
                  className='w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all'
                  placeholder='Your name'
                />
              </div>
              <div>
                <label
                  htmlFor='phone_number'
                  className='block text-sm font-medium text-white/90 my-2'
                >
                  Phone Number <span className='text-red-400'>*</span>
                </label>
                <input
                  type='tel'
                  id='phone_number'
                  name='phone_number'
                  required
                  value={formData.phone_number}
                  onChange={handleInputChange}
                  className='w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all'
                  placeholder='+91 98765 43210'
                />
              </div>
            </div>
            <div>
              <label
                htmlFor='email'
                className='block text-sm font-medium text-white/90 my-2'
              >
                Email
              </label>
              <input
                type='email'
                id='email'
                name='email'
                value={formData.email}
                onChange={handleInputChange}
                className='w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all'
                placeholder='your.email@example.com'
              />
            </div>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-6'>
              <div>
                <label
                  htmlFor='car_name'
                  className='block text-sm font-medium text-white/90 my-2'
                >
                  Car Name
                </label>
                <input
                  type='text'
                  id='car_name'
                  name='car_name'
                  value={formData.car_name}
                  onChange={handleInputChange}
                  className='w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all'
                  placeholder='e.g., BMW 5 Series'
                />
              </div>
              <div>
                <label
                  htmlFor='location'
                  className='block text-sm font-medium text-white/90 my-2'
                >
                  Location
                </label>
                <input
                  type='text'
                  id='location'
                  name='location'
                  value={formData.location}
                  onChange={handleInputChange}
                  className='w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all'
                  placeholder='City'
                />
              </div>
            </div>
            {message && (
              <div
                className={`text-sm font-medium rounded-lg p-4 ${
                  message.type === 'success'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-red-500/20 text-red-400 border border-red-500/30'
                }`}
              >
                {message.text}
              </div>
            )}
            <div className='flex gap-4 mt-8'>
              <button
                type='button'
                onClick={handleBack}
                className='flex-1 px-8 py-4 bg-white/5 border border-white/10 text-white font-bold uppercase tracking-wider rounded-lg hover:bg-white/10 transition-all'
              >
                Back
              </button>
              <button
                type='submit'
                disabled={isSubmitting}
                className='flex-1 px-8 py-4 bg-amber-500 text-black font-bold uppercase tracking-wider rounded-lg hover:bg-amber-400 transition-all transform hover:scale-[1.02] shadow-lg shadow-amber-900/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none'
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
