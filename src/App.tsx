import { AuthProvider, useAuth } from './auth';
import { Game } from './Game';
import { Login } from './Login';
import './App.css';

function Root() {
  const { user } = useAuth();
  return user ? <Game /> : <Login />;
}

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
