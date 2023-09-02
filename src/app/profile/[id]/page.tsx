export default function UserProfile({params}: any) {
  return (
    <div>
      <h1>Profile</h1>
      <hr />
      <p>Profile Page of {params.id}</p>
    </div>
  )
}