
import React from 'react';
import Editor from './components/Editor';

const App: React.FC = () => {
  return (
    <div className="min-h-screen font-sans selection:bg-[#3BD23D] selection:text-black bg-black">
      <Editor />
    </div>
  );
};

export default App;
