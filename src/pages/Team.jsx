import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import GradeBadge from '../astryx/GradeBadge'
import { VStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Avatar } from '@astryxdesign/core/Avatar'
import { AstryxPage, PageHeader } from '../astryx/AstryxPage'


export default function Team() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  // 재직 중인 직원 이름·입사일만 (예전 meta 문서에는 시급이 들어 있어 더 이상 읽지 않음)
  useEffect(()=>{
    getDocs(collection(db,'users')).then(snap => {
      const list = []
      snap.forEach(d => {
        const u = d.data()
        if (u.status === 'approved' && !['owner','store','investor'].includes(u.role) && u.name)
          list.push({ uid:d.id, name:String(u.name), joinDate:u.joinDate || '' })
      })
      list.sort((a,b) => (a.joinDate || '9') < (b.joinDate || '9') ? -1 : 1)
      setEmployees(list)
    }).catch(e => console.error(e)).finally(() => setLoading(false))
  },[])

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="팀원 소개" sub="홍콩반점 중앙대점 함께하는 멤버들"/>
      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        <Card variant="red" padding={4}>
          <VStack gap={1}>
            <Heading level={3}>홍콩반점 중앙대점</Heading>
            <Text color="inherit">총 {employees.length}명이 함께하고 있어요</Text>
          </VStack>
        </Card>
        <Grid columns={{ minWidth: 200, repeat: 'fill' }} gap={3}>
          {employees.map(e => (
            <Card key={e.uid} padding={4}>
              <VStack gap={2}>
                <Avatar name={e.name.length >= 3 ? e.name.slice(-2) : e.name} size={48}/>
                <Heading level={4}>{e.name}</Heading>
                <GradeBadge joinDate={e.joinDate}/>
                {e.joinDate && <Text type="supporting" color="secondary" hasTabularNumbers>입사일 {e.joinDate}</Text>}
              </VStack>
            </Card>
          ))}
        </Grid>
      </>}
    </VStack>
    </AstryxPage>
  )
}
