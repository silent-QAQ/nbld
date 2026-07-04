using UnityEngine;

namespace NBLD.World
{
    public class FollowCamera : MonoBehaviour
    {
        [SerializeField] private Transform target;
        [SerializeField] private Vector3 offset = new Vector3(0f, -18f, -30f);
        [SerializeField] private Vector3 rotationEuler = new Vector3(35f, 0f, 0f);
        [SerializeField] private float smoothTime = 0.12f;
        [SerializeField] private float orthographicSize = 45f;

        private Vector3 _velocity;
        private Camera _camera;

        public void SetTarget(Transform newTarget)
        {
            target = newTarget;
            SnapToTarget();
        }

        private void LateUpdate()
        {
            if (target == null)
            {
                return;
            }

            var desiredPosition = target.position + offset;
            transform.position = Vector3.SmoothDamp(transform.position, desiredPosition, ref _velocity, smoothTime);
            transform.rotation = Quaternion.Euler(rotationEuler);
        }

        private void Start()
        {
            _camera = GetComponent<Camera>();
            if (_camera != null)
            {
                _camera.orthographic = true;
                _camera.orthographicSize = orthographicSize;
            }
            SnapToTarget();
        }

        private void SnapToTarget()
        {
            if (target == null)
            {
                return;
            }

            transform.position = target.position + offset;
            transform.rotation = Quaternion.Euler(rotationEuler);
        }
    }
}
