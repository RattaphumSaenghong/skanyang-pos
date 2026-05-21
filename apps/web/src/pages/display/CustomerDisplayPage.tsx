import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

interface DisplayImage {
  id: string;
  url: string;
  sortOrder: number;
}

export default function CustomerDisplayPage() {
  const { shopId } = useParams<{ shopId: string }>();
  const [images, setImages] = useState<DisplayImage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // Poll for images every 5 seconds
  useEffect(() => {
    const fetchImages = () =>
      fetch(`/api/display/${shopId}/images`)
        .then((r) => r.json())
        .then((data: DisplayImage[]) => setImages(data))
        .catch(() => {});

    fetchImages();
    const poll = setInterval(fetchImages, 5000);
    return () => clearInterval(poll);
  }, [shopId]);

  // Cycle slides every 5 seconds with fade transition
  useEffect(() => {
    if (images.length <= 1) return;
    const slide = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setCurrentIndex((i) => (i + 1) % images.length);
        setVisible(true);
      }, 400);
    }, 5000);
    return () => clearInterval(slide);
  }, [images.length]);

  if (images.length === 0) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#fff', fontSize: '3rem', fontWeight: 'bold' }}>ส.การยาง</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <img
        key={currentIndex}
        src={images[currentIndex]?.url}
        alt=""
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          objectFit: 'cover',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.4s ease-in-out',
        }}
      />
    </div>
  );
}
