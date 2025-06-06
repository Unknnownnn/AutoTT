import React, { useState, useEffect } from 'react';
import TypingTitle from './TypingTitle';

type CyclingTypingTitleProps = {
  texts: string[];
  typingDuration?: number;
  pauseDuration?: number;
  className?: string;
  isTypeByLetter?: boolean;
  cursor?: string;
  cursorColor?: string;
};

const CyclingTypingTitle: React.FC<CyclingTypingTitleProps> = ({
  texts,
  typingDuration = 100,
  pauseDuration = 2000,
  className = "",
  isTypeByLetter = true,
  cursor = "|",
  cursorColor = "text-blue-400"
}) => {
  const [textIndex, setTextIndex] = useState(0);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  
  // When typing is complete, wait for pauseDuration then move to next text
  useEffect(() => {
    if (!isTypingComplete) return;
    
    const nextTextTimeout = setTimeout(() => {
      setTextIndex((prevIndex) => (prevIndex >= texts.length - 1 ? 0 : prevIndex + 1));
      setIsTypingComplete(false);
    }, pauseDuration);
    
    return () => clearTimeout(nextTextTimeout);
  }, [isTypingComplete, texts.length, pauseDuration]);
  
  return (
    <TypingTitle
      text={texts[textIndex]}
      duration={typingDuration}
      className={className}
      isTypeByLetter={isTypeByLetter}
      onComplete={() => setIsTypingComplete(true)}
      cursor={cursor}
      cursorColor={cursorColor}
    />
  );
};

export default CyclingTypingTitle; 