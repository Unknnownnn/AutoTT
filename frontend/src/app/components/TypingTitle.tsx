import React, { useState, useEffect } from 'react';
import useTypingEffect from '../hooks/useTypingEffect';

type TypingTitleProps = {
  text: string;
  duration?: number;
  className?: string;
  isTypeByLetter?: boolean;
  onComplete?: () => void;
  cursor?: string;
  cursorColor?: string;
};

const TypingTitle: React.FC<TypingTitleProps> = ({
  text,
  duration = 100,
  className = "",
  isTypeByLetter = true,
  onComplete,
  cursor = "|",
  cursorColor = "text-blue-400"
}) => {
  const displayText = useTypingEffect(text, duration, isTypeByLetter);
  const [showCursor, setShowCursor] = useState(true);
  
  // Blinking cursor effect
  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setShowCursor(prev => !prev);
    }, 500);
    
    return () => clearInterval(cursorInterval);
  }, []);
  
  // Call onComplete when typing is finished
  useEffect(() => {
    if (displayText === text && onComplete) {
      const timeout = setTimeout(() => {
        onComplete();
      }, 400); // Wait a second after completion before calling onComplete
      
      return () => clearTimeout(timeout);
    }
  }, [displayText, text, onComplete]);
  
  return (
    <span className={`font-mono ${className}`}>
      {displayText}
      <span className={`${showCursor ? 'opacity-100' : 'opacity-0'} transition-opacity duration-100 ${cursorColor}`}>
        {cursor}
      </span>
    </span>
  );
};

export default TypingTitle; 